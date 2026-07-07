import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AttachmentInfo, MAX_ATTACHMENT_CIPHERTEXT_BYTES } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ChannelAccessService } from '../messages/channel-access.service';

/**
 * Verschlüsselte Anhänge (Phase 8). Ablauf: Client verschlüsselt die Datei mit
 * einem zufälligen Dateischlüssel, lädt den Ciphertext-Blob hier hoch und
 * bindet die zurückgegebene ID beim Senden an die Nachricht; der Schlüssel
 * wandert im E2EE-Nachrichtentext. Der Server sieht nur Blob + Größe.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /** Upload in einen Kanal – gleiche Berechtigung wie Nachricht senden. */
  async upload(channelId: string, userId: string, data: Buffer): Promise<AttachmentInfo> {
    await this.channelAccess.requireChannelAccess(channelId, userId, 'send');
    if (data.length === 0) throw new BadRequestException('Leerer Anhang');
    if (data.length > MAX_ATTACHMENT_CIPHERTEXT_BYTES) {
      throw new BadRequestException('Anhang ist zu groß (max. 10 MiB)');
    }

    // Objektname ist zufällig und wird nie an Clients ausgeliefert.
    const objectKey = `${channelId}/${randomUUID()}`;
    await this.storage.putObject(objectKey, data);
    try {
      const attachment = await this.prisma.attachment.create({
        data: { channelId, uploaderId: userId, objectKey, sizeBytes: data.length },
      });
      return { id: attachment.id, sizeBytes: attachment.sizeBytes };
    } catch (err) {
      // DB-Zeile fehlgeschlagen → Blob nicht verwaisen lassen.
      await this.storage.removeObject(objectKey).catch(() => undefined);
      throw err;
    }
  }

  /** Download des Ciphertext-Blobs – nur für Kanal-Mitglieder (404 für Fremde). */
  async download(
    attachmentId: string,
    userId: string,
  ): Promise<{ stream: Readable; sizeBytes: number }> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Anhang nicht gefunden');
    // Noch an keine Nachricht gebunden → nur der Uploader selbst darf lesen.
    if (attachment.messageId === null && attachment.uploaderId !== userId) {
      throw new NotFoundException('Anhang nicht gefunden');
    }
    await this.channelAccess.requireChannelAccess(attachment.channelId, userId, 'read');
    const stream = await this.storage.getObjectStream(attachment.objectKey);
    return { stream, sizeBytes: attachment.sizeBytes };
  }
}
