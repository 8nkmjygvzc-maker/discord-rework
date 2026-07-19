import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { Sticker } from '@prisma/client';
import { hasPermission, MAX_STICKER_BYTES, Permissions, StickerInfo } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { UpdateStickerDto } from './dto/update-sticker.dto';

/**
 * Sticker (Discord-artig): Server-weite Bild-Bibliothek für Textnachrichten.
 * Die API verwaltet nur die Bibliothek (Liste, Upload, Umbenennen, Löschen,
 * Bild-Stream) – das VERSCHICKEN eines Stickers ist eine ganz normale
 * E2EE-Nachricht (MessageContentV1.sticker) und läuft durch die bestehende
 * Nachrichten-Pipeline; der Server kann sie nicht von Text unterscheiden.
 *
 * Rechte: ViewChannels für Liste/Bild, ManageStickers zum Hochladen/Ändern;
 * löschen darf zusätzlich der Uploader selbst (wie beim Soundboard).
 */
@Injectable()
export class StickersService {
  private readonly logger = new Logger(StickersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Sticker-Bibliothek eines Servers – für jedes Mitglied mit ViewChannels. */
  async list(serverId: string, userId: string): Promise<StickerInfo[]> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ViewChannels);
    const stickers = await this.prisma.sticker.findMany({
      where: { serverId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    return stickers.map(toStickerInfo);
  }

  /** Neuen Sticker hochladen (roher Bild-Body, Metadaten als Query-Parameter). */
  async create(
    serverId: string,
    userId: string,
    dto: CreateStickerDto,
    data: Buffer,
  ): Promise<StickerInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageStickers);
    await this.assertNotTimedOut(serverId, userId);
    if (data.length === 0) throw new BadRequestException('Leere Bilddatei');
    if (data.length > MAX_STICKER_BYTES) {
      throw new BadRequestException('Sticker ist zu groß (max. 1 MiB)');
    }

    // Objektname ist zufällig; das Server-Präfix erlaubt das Aufräumen aller
    // Sticker beim Server-Löschen (removeAllWithPrefix, siehe ServersService).
    const objectKey = `stickers/${serverId}/${randomUUID()}`;
    await this.storage.putObject(objectKey, data);
    try {
      const sticker = await this.prisma.sticker.create({
        data: {
          serverId,
          uploaderId: userId,
          name: dto.name,
          mimeType: dto.mimeType,
          objectKey,
          sizeBytes: data.length,
        },
      });
      await this.broadcastUpdate(serverId);
      return toStickerInfo(sticker);
    } catch (err) {
      // DB-Zeile fehlgeschlagen → Blob nicht verwaisen lassen (wie Phase 8).
      await this.storage.removeObject(objectKey).catch(() => undefined);
      throw err;
    }
  }

  /** Umbenennen (ManageStickers). */
  async update(
    serverId: string,
    stickerId: string,
    userId: string,
    dto: UpdateStickerDto,
  ): Promise<StickerInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageStickers);
    const sticker = await this.requireServerSticker(serverId, stickerId);
    const updated = await this.prisma.sticker.update({
      where: { id: sticker.id },
      data: { name: dto.name },
    });
    await this.broadcastUpdate(serverId);
    return toStickerInfo(updated);
  }

  /** Löschen darf, wer ManageStickers hat ODER den Sticker selbst hochgeladen hat. */
  async remove(serverId: string, stickerId: string, userId: string): Promise<void> {
    // ViewChannels stellt die Mitgliedschaft fest (404 für Fremde, kein Leak) …
    const granted = await this.permissions.requirePermission(
      serverId,
      userId,
      Permissions.ViewChannels,
    );
    const sticker = await this.requireServerSticker(serverId, stickerId);
    // … die eigentliche Berechtigung prüft danach Verwaltung ODER Eigentum.
    if (!hasPermission(granted, Permissions.ManageStickers) && sticker.uploaderId !== userId) {
      throw new ForbiddenException('Dir fehlt die Berechtigung dafür');
    }
    await this.prisma.sticker.delete({ where: { id: sticker.id } });
    // Best-effort: Die DB-Zeile ist weg, ein Storage-Fehler hinterlässt nur
    // einen unerreichbaren Blob (geloggt).
    await this.storage.removeObject(sticker.objectKey).catch((err: unknown) => {
      this.logger.warn(`Sticker-Blob ${sticker.objectKey} nicht löschbar: ${String(err)}`);
    });
    await this.broadcastUpdate(serverId);
  }

  /** Bild-Blob streamen – nur für Mitglieder des Sticker-Servers (404 für Fremde). */
  async getImage(
    stickerId: string,
    userId: string,
  ): Promise<{ stream: Readable; sizeBytes: number; mimeType: string }> {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker) throw new NotFoundException('Sticker nicht gefunden');
    await this.permissions.requirePermission(sticker.serverId, userId, Permissions.ViewChannels);
    const stream = await this.storage.getObjectStream(sticker.objectKey);
    return { stream, sizeBytes: sticker.sizeBytes, mimeType: sticker.mimeType };
  }

  // --- intern ---------------------------------------------------------------

  /** Auszeit (Phase 13) blockiert Sticker-Uploads (Senden blockt die Messages-Pipeline). */
  private async assertNotTimedOut(serverId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      select: { timeoutUntil: true },
    });
    if (membership?.timeoutUntil && membership.timeoutUntil.getTime() > Date.now()) {
      throw new ForbiddenException('Du bist in Auszeit und kannst keine Sticker hochladen');
    }
  }

  /** 404, wenn der Sticker nicht existiert oder zu einem anderen Server gehört. */
  private async requireServerSticker(serverId: string, stickerId: string): Promise<Sticker> {
    const sticker = await this.prisma.sticker.findUnique({ where: { id: stickerId } });
    if (!sticker || sticker.serverId !== serverId) {
      throw new NotFoundException('Sticker nicht gefunden');
    }
    return sticker;
  }

  /** Bibliothek geändert → Mitglieder mit ViewChannels laden ihre Liste neu. */
  private async broadcastUpdate(serverId: string): Promise<void> {
    const recipients = await this.permissions.getMemberIdsWithPermission(
      serverId,
      Permissions.ViewChannels,
    );
    await this.gateway.publishDispatch('STICKER_UPDATE', { serverId }, recipients);
  }
}

// DB-Objekte nie direkt ausliefern (objectKey bleibt intern).
function toStickerInfo(sticker: Sticker): StickerInfo {
  return {
    id: sticker.id,
    serverId: sticker.serverId,
    name: sticker.name,
    mimeType: sticker.mimeType,
    sizeBytes: sticker.sizeBytes,
    uploaderId: sticker.uploaderId,
    createdAt: sticker.createdAt.toISOString(),
  };
}
