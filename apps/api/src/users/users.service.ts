import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  MAX_PROFILE_IMAGE_BYTES,
  type AuthUser,
  type PresenceModeUpdatePayload,
  type PresenceUpdatePayload,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { GatewayService } from '../gateway/gateway.service';
import { PresenceService } from '../gateway/presence.service';
import { VisibilityService } from '../gateway/visibility.service';
import { detectImageContentType } from '../common/image.util';
import { presenceToDb } from '../common/presence.util';
import { toAuthUser } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: GatewayService,
    private readonly presence: PresenceService,
    private readonly visibility: VisibilityService,
  ) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden');
    return toAuthUser(user);
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AuthUser> {
    // Alten Anwesenheits-Modus merken – nur ein ECHTER Wechsel löst die
    // Presence-Broadcasts aus (sonst würde jedes Status-Text-Speichern senden).
    const before =
      dto.presence !== undefined
        ? await this.prisma.user.findUnique({ where: { id }, select: { presence: true } })
        : null;

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        // '' = Bild entfernen (Upload ist der einzige Weg, eines zu setzen).
        ...(dto.avatarUrl !== undefined ? { avatarUrl: null } : {}),
        ...(dto.bannerUrl !== undefined ? { bannerUrl: null } : {}),
        ...(dto.presence !== undefined ? { presence: presenceToDb(dto.presence) } : {}),
      },
    });
    const result = toAuthUser(user);

    // USER_UPDATE (Profil an den Sichtbarkeitskreis) nur bei Profilfeldern –
    // der Anwesenheits-Modus ist KEIN öffentliches Profildatum.
    if (dto.status !== undefined || dto.avatarUrl !== undefined || dto.bannerUrl !== undefined) {
      await this.broadcastProfileUpdate(result);
    }
    if (before && before.presence !== user.presence) {
      await this.broadcastPresenceModeChange(result);
    }
    return result;
  }

  /**
   * Anwesenheits-Modus geändert: Der Nutzer selbst (alle Tabs/Geräte) bekommt
   * den ECHTEN Modus; der Sichtbarkeitskreis nur den sichtbaren Effekt als
   * normales PRESENCE_UPDATE – 'invisible' muss für andere ununterscheidbar
   * von echtem Offline sein.
   */
  private async broadcastPresenceModeChange(user: AuthUser): Promise<void> {
    await this.gateway.publishDispatch(
      'PRESENCE_MODE_UPDATE',
      { presence: user.presence } satisfies PresenceModeUpdatePayload,
      [user.id],
    );

    // Ohne lebende Gateway-Verbindung gibt es nichts zu melden – der Nutzer
    // ist ohnehin für alle offline.
    if (!(await this.presence.isOnline(user.id))) return;

    const visibleTo = await this.visibility.getVisibleUserIds(user.id);
    const payload: PresenceUpdatePayload =
      user.presence === 'invisible'
        ? { user: { id: user.id, username: user.username }, online: false }
        : {
            user: { id: user.id, username: user.username, presence: user.presence },
            online: true,
          };
    await this.gateway.publishDispatch('PRESENCE_UPDATE', payload, [...visibleTo, user.id]);
  }

  /**
   * Profilbild hochladen (Phase 15). Bewusst UNverschlüsselt: Avatare sind –
   * wie der Nutzername – öffentliche Metadaten und müssen per <img> ohne
   * Auth-Header ladbar sein. Der Blob überschreibt das vorherige Bild;
   * die avatarUrl trägt eine Versions-Query für Cache-Busting.
   */
  async setAvatar(userId: string, data: Buffer): Promise<AuthUser> {
    if (data.length === 0) throw new BadRequestException('Leeres Bild');
    if (data.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new BadRequestException('Profilbild ist zu groß (max. 2 MiB)');
    }
    const contentType = detectImageContentType(data);
    if (!contentType) {
      throw new BadRequestException('Nur Bilder (PNG, JPEG, WebP, GIF) sind erlaubt');
    }
    await this.storage.putObject(avatarKey(userId), data, contentType);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: `/api/users/${userId}/avatar?v=${Date.now()}` },
    });
    const result = toAuthUser(user);
    await this.broadcastProfileUpdate(result);
    return result;
  }

  /** Avatar-Blob streamen – öffentlich (siehe UsersPublicController). */
  async getAvatarStream(
    userId: string,
  ): Promise<{ stream: Readable; sizeBytes: number; contentType: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });
    // Nur ausliefern, was über setAvatar hochgeladen wurde (avatarUrl zeigt
    // dann auf diesen Endpunkt) – sonst 404 statt MinIO-Fehler.
    if (!user?.avatarUrl?.startsWith(`/api/users/${userId}/avatar`)) {
      throw new NotFoundException('Kein Profilbild vorhanden');
    }
    return this.streamProfileImage(avatarKey(userId), 'Kein Profilbild vorhanden');
  }

  /** Profil-Banner hochladen – gleiche Regeln wie der Avatar (unverschlüsselt). */
  async setBanner(userId: string, data: Buffer): Promise<AuthUser> {
    if (data.length === 0) throw new BadRequestException('Leeres Bild');
    if (data.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new BadRequestException('Banner ist zu groß (max. 2 MiB)');
    }
    const contentType = detectImageContentType(data);
    if (!contentType) {
      throw new BadRequestException('Nur Bilder (PNG, JPEG, WebP, GIF) sind erlaubt');
    }
    await this.storage.putObject(bannerKey(userId), data, contentType);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { bannerUrl: `/api/users/${userId}/banner?v=${Date.now()}` },
    });
    const result = toAuthUser(user);
    await this.broadcastProfileUpdate(result);
    return result;
  }

  /** Banner-Blob streamen – öffentlich (siehe UsersPublicController). */
  async getBannerStream(
    userId: string,
  ): Promise<{ stream: Readable; sizeBytes: number; contentType: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { bannerUrl: true },
    });
    if (!user?.bannerUrl?.startsWith(`/api/users/${userId}/banner`)) {
      throw new NotFoundException('Kein Banner vorhanden');
    }
    return this.streamProfileImage(bannerKey(userId), 'Kein Banner vorhanden');
  }

  private async streamProfileImage(
    objectKey: string,
    notFoundMessage: string,
  ): Promise<{ stream: Readable; sizeBytes: number; contentType: string }> {
    try {
      const [stat, stream] = await Promise.all([
        this.storage.statObject(objectKey),
        this.storage.getObjectStream(objectKey),
      ]);
      return {
        stream,
        sizeBytes: stat.sizeBytes,
        contentType: stat.contentType ?? 'application/octet-stream',
      };
    } catch {
      throw new NotFoundException(notFoundMessage);
    }
  }

  /**
   * Profiländerung (Status/Avatar) live an alle verteilen, die den Nutzer
   * sehen (Freunde, gemeinsame Server, DM-Partner) – plus an ihn selbst
   * (andere Tabs/Geräte).
   */
  private async broadcastProfileUpdate(user: AuthUser): Promise<void> {
    const visibleTo = await this.visibility.getVisibleUserIds(user.id);
    await this.gateway.publishDispatch(
      'USER_UPDATE',
      {
        user: {
          id: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
          bannerUrl: user.bannerUrl,
          status: user.status,
        },
      },
      [...visibleTo, user.id],
    );
  }
}

/** Objektschlüssel des Avatars im (gemeinsamen) MinIO-Bucket. */
function avatarKey(userId: string): string {
  return `avatars/${userId}`;
}

/** Objektschlüssel des Profil-Banners im (gemeinsamen) MinIO-Bucket. */
function bannerKey(userId: string): string {
  return `banners/${userId}`;
}
