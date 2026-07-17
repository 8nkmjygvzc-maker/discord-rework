import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { SoundboardSound } from '@prisma/client';
import {
  hasPermission,
  isPlausibleReactionEmoji,
  MAX_SOUNDBOARD_SOUND_BYTES,
  Permissions,
  SoundboardPlayPayload,
  SoundboardSoundInfo,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { CreateSoundDto } from './dto/create-sound.dto';
import { UpdateSoundDto } from './dto/update-sound.dto';

/**
 * Soundboard (Discord-artig): Server-weite Sound-Bibliothek für Sprachkanäle.
 * Die Anzahl der Sounds pro Server ist unbegrenzt, nur die Dateigröße pro Sound
 * ist gedeckelt. Abspielen läuft über die REST-API → SOUNDBOARD_PLAY-Event an
 * alle, die GERADE im Sprachkanal sitzen; jeder Client spielt lokal ab (kein
 * Audio-Mixing im SFU – gleiche Mechanik wie bei Discord).
 *
 * Rechte: UseSoundboard zum Abspielen (Standardrolle), ManageSoundboard zum
 * Hochladen/Ändern; löschen darf zusätzlich der Uploader selbst.
 */
@Injectable()
export class SoundboardService {
  private readonly logger = new Logger(SoundboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Sound-Bibliothek eines Servers – für jedes Mitglied mit ViewChannels. */
  async list(serverId: string, userId: string): Promise<SoundboardSoundInfo[]> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ViewChannels);
    const sounds = await this.prisma.soundboardSound.findMany({
      where: { serverId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    return sounds.map(toSoundInfo);
  }

  /** Neuen Sound hochladen (roher Audio-Body, Metadaten als Query-Parameter). */
  async create(
    serverId: string,
    userId: string,
    dto: CreateSoundDto,
    data: Buffer,
  ): Promise<SoundboardSoundInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageSoundboard);
    await this.assertNotTimedOut(serverId, userId);
    if (data.length === 0) throw new BadRequestException('Leere Audiodatei');
    if (data.length > MAX_SOUNDBOARD_SOUND_BYTES) {
      throw new BadRequestException('Sound ist zu groß (max. 10 MiB)');
    }
    if (dto.emoji !== undefined && !isPlausibleReactionEmoji(dto.emoji)) {
      throw new BadRequestException('Ungültiges Emoji');
    }

    // Objektname ist zufällig; das Server-Präfix erlaubt das Aufräumen aller
    // Sounds beim Server-Löschen (removeAllWithPrefix, siehe ServersService).
    const objectKey = `soundboard/${serverId}/${randomUUID()}`;
    await this.storage.putObject(objectKey, data);
    try {
      const sound = await this.prisma.soundboardSound.create({
        data: {
          serverId,
          uploaderId: userId,
          name: dto.name,
          emoji: dto.emoji ?? null,
          volume: dto.volume ?? 1,
          mimeType: dto.mimeType,
          objectKey,
          sizeBytes: data.length,
        },
      });
      await this.broadcastUpdate(serverId);
      return toSoundInfo(sound);
    } catch (err) {
      // DB-Zeile fehlgeschlagen → Blob nicht verwaisen lassen (wie Phase 8).
      await this.storage.removeObject(objectKey).catch(() => undefined);
      throw err;
    }
  }

  /** Name/Emoji/Lautstärke ändern (ManageSoundboard). */
  async update(
    serverId: string,
    soundId: string,
    userId: string,
    dto: UpdateSoundDto,
  ): Promise<SoundboardSoundInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageSoundboard);
    const sound = await this.requireServerSound(serverId, soundId);
    if (dto.emoji != null && !isPlausibleReactionEmoji(dto.emoji)) {
      throw new BadRequestException('Ungültiges Emoji');
    }
    const updated = await this.prisma.soundboardSound.update({
      where: { id: sound.id },
      // undefined = Feld unverändert; emoji: null entfernt das Emoji.
      data: { name: dto.name, emoji: dto.emoji, volume: dto.volume },
    });
    await this.broadcastUpdate(serverId);
    return toSoundInfo(updated);
  }

  /** Löschen darf, wer ManageSoundboard hat ODER den Sound selbst hochgeladen hat. */
  async remove(serverId: string, soundId: string, userId: string): Promise<void> {
    // ViewChannels stellt die Mitgliedschaft fest (404 für Fremde, kein Leak) …
    const granted = await this.permissions.requirePermission(
      serverId,
      userId,
      Permissions.ViewChannels,
    );
    const sound = await this.requireServerSound(serverId, soundId);
    // … die eigentliche Berechtigung prüft danach Verwaltung ODER Eigentum.
    if (!hasPermission(granted, Permissions.ManageSoundboard) && sound.uploaderId !== userId) {
      throw new ForbiddenException('Dir fehlt die Berechtigung dafür');
    }
    await this.prisma.soundboardSound.delete({ where: { id: sound.id } });
    // Best-effort: Die DB-Zeile ist weg, ein Storage-Fehler hinterlässt nur
    // einen unerreichbaren Blob (geloggt).
    await this.storage.removeObject(sound.objectKey).catch((err: unknown) => {
      this.logger.warn(`Sound-Blob ${sound.objectKey} nicht löschbar: ${String(err)}`);
    });
    await this.broadcastUpdate(serverId);
  }

  /** Audio-Blob streamen – nur für Mitglieder des Sound-Servers (404 für Fremde). */
  async getAudio(
    soundId: string,
    userId: string,
  ): Promise<{ stream: Readable; sizeBytes: number; mimeType: string }> {
    const sound = await this.prisma.soundboardSound.findUnique({ where: { id: soundId } });
    if (!sound) throw new NotFoundException('Sound nicht gefunden');
    await this.permissions.requirePermission(sound.serverId, userId, Permissions.ViewChannels);
    const stream = await this.storage.getObjectStream(sound.objectKey);
    return { stream, sizeBytes: sound.sizeBytes, mimeType: sound.mimeType };
  }

  /**
   * Sound in einem Sprachkanal abspielen: verlangt UseSoundboard UND eine
   * eigene aktive Voice-Session in genau diesem Kanal. Das Event geht nur an
   * Nutzer, die gerade im Kanal sitzen – nicht an den ganzen Server.
   */
  async play(channelId: string, soundId: string, userId: string, username: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || !channel.serverId || channel.type !== 'VOICE') {
      throw new NotFoundException('Sprachkanal nicht gefunden');
    }
    await this.permissions.requirePermission(channel.serverId, userId, Permissions.UseSoundboard);
    await this.assertNotTimedOut(channel.serverId, userId);

    const sound = await this.prisma.soundboardSound.findUnique({ where: { id: soundId } });
    if (!sound || sound.serverId !== channel.serverId) {
      throw new NotFoundException('Sound nicht gefunden');
    }

    const session = await this.prisma.voiceSession.findUnique({ where: { userId } });
    if (!session || session.channelId !== channelId) {
      throw new BadRequestException('Du bist nicht in diesem Sprachkanal');
    }

    const listeners = await this.prisma.voiceSession.findMany({
      where: { channelId },
      select: { userId: true },
    });
    const payload: SoundboardPlayPayload = {
      channelId,
      sound: toSoundInfo(sound),
      userId,
      username,
    };
    await this.gateway.publishDispatch(
      'SOUNDBOARD_PLAY',
      payload,
      listeners.map((l) => l.userId),
    );
  }

  // --- intern ---------------------------------------------------------------

  /** Auszeit (Phase 13) blockiert Soundboard-Uploads und -Wiedergabe. */
  private async assertNotTimedOut(serverId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      select: { timeoutUntil: true },
    });
    if (membership?.timeoutUntil && membership.timeoutUntil.getTime() > Date.now()) {
      throw new ForbiddenException('Du bist in Auszeit und kannst das Soundboard nicht nutzen');
    }
  }

  /** 404, wenn der Sound nicht existiert oder zu einem anderen Server gehört. */
  private async requireServerSound(serverId: string, soundId: string): Promise<SoundboardSound> {
    const sound = await this.prisma.soundboardSound.findUnique({ where: { id: soundId } });
    if (!sound || sound.serverId !== serverId) throw new NotFoundException('Sound nicht gefunden');
    return sound;
  }

  /** Bibliothek geändert → Mitglieder mit ViewChannels laden ihre Liste neu. */
  private async broadcastUpdate(serverId: string): Promise<void> {
    const recipients = await this.permissions.getMemberIdsWithPermission(
      serverId,
      Permissions.ViewChannels,
    );
    await this.gateway.publishDispatch('SOUNDBOARD_UPDATE', { serverId }, recipients);
  }
}

// DB-Objekte nie direkt ausliefern (objectKey bleibt intern).
function toSoundInfo(sound: SoundboardSound): SoundboardSoundInfo {
  return {
    id: sound.id,
    serverId: sound.serverId,
    name: sound.name,
    emoji: sound.emoji,
    volume: sound.volume,
    mimeType: sound.mimeType,
    sizeBytes: sound.sizeBytes,
    uploaderId: sound.uploaderId,
    createdAt: sound.createdAt.toISOString(),
  };
}
