import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { MAX_PROFILE_IMAGE_BYTES, type AuthUser } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { GatewayService } from '../gateway/gateway.service';
import { VisibilityService } from '../gateway/visibility.service';
import { detectImageContentType } from '../common/image.util';
import { toAuthUser } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: GatewayService,
    private readonly visibility: VisibilityService,
  ) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden');
    return toAuthUser(user);
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        // '' = Bild entfernen (Upload ist der einzige Weg, eines zu setzen).
        ...(dto.avatarUrl !== undefined ? { avatarUrl: null } : {}),
      },
    });
    const result = toAuthUser(user);
    await this.broadcastProfileUpdate(result);
    return result;
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
    try {
      const [stat, stream] = await Promise.all([
        this.storage.statObject(avatarKey(userId)),
        this.storage.getObjectStream(avatarKey(userId)),
      ]);
      return {
        stream,
        sizeBytes: stat.sizeBytes,
        contentType: stat.contentType ?? 'application/octet-stream',
      };
    } catch {
      throw new NotFoundException('Kein Profilbild vorhanden');
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
