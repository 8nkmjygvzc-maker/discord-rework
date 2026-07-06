import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  cryptoReady,
  DeviceKeyBundle,
  KeyEnvelopeInfo,
  KeyEnvelopePayload,
  verifySignedPreKey,
} from '@parley/shared';
import { KeyEnvelope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { RegisterKeysDto } from './dto/register-keys.dto';
import { SendEnvelopeDto } from './dto/send-envelope.dto';

/** Obergrenze für Umschläge – eine Sender-Key-Verteilung ist < 2 KiB. */
const MAX_ENVELOPE_BYTES = 16 * 1024;
/** Mailbox-Limit pro Empfänger – schützt vor Zumüllen durch einen Angreifer. */
const MAX_MAILBOX_SIZE = 1000;

/**
 * Schlüsselverwaltung (Phase 6): speichert ausschließlich ÖFFENTLICHE
 * Geräteschlüssel und transportiert Ende-zu-Ende-verschlüsselte
 * Schlüssel-Umschläge (Mailbox + KEY_ENVELOPE-Gateway-Event).
 */
@Injectable()
export class KeysService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
  ) {}

  async onModuleInit(): Promise<void> {
    // libsodium wird nur für die Plausibilitätsprüfung der Prekey-Signatur
    // beim Upload gebraucht – entschlüsseln kann der Server nichts.
    await cryptoReady();
  }

  /**
   * Registriert bzw. erneuert die Geräteschlüssel des Nutzers (v1: ein Gerät
   * pro Account). Ein Wechsel des Identitätsschlüssels ist ein Schlüssel-Reset
   * (z. B. neuer Browser) – alte Umschläge sind dann unlesbar und werden
   * verworfen.
   */
  async registerKeys(userId: string, dto: RegisterKeysDto): Promise<void> {
    const valid = verifySignedPreKey({
      userId,
      identityKey: dto.identityKey,
      signedPreKey: dto.signedPreKey,
      signedPreKeySignature: dto.signedPreKeySignature,
    });
    if (!valid) {
      throw new BadRequestException('Prekey-Signatur passt nicht zum Identitätsschlüssel');
    }

    const existing = await this.prisma.device.findUnique({ where: { userId } });
    if (existing && existing.identityKey !== dto.identityKey) {
      // Schlüssel-Reset: an alte Sessions gerichtete Umschläge sind wertlos.
      await this.prisma.keyEnvelope.deleteMany({ where: { toUserId: userId } });
    }
    await this.prisma.device.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });
  }

  /** Öffentliches Schlüsselbündel eines Nutzers (für X3DH). */
  async getBundle(userId: string): Promise<DeviceKeyBundle> {
    const device = await this.prisma.device.findUnique({ where: { userId } });
    if (!device) throw new NotFoundException('Nutzer hat keine Schlüssel registriert');
    return {
      userId,
      identityKey: device.identityKey,
      signedPreKey: device.signedPreKey,
      signedPreKeySignature: device.signedPreKeySignature,
    };
  }

  async sendEnvelope(fromUserId: string, dto: SendEnvelopeDto): Promise<void> {
    if (JSON.stringify(dto.payload).length > MAX_ENVELOPE_BYTES) {
      throw new BadRequestException('Umschlag ist zu groß');
    }
    const recipient = await this.prisma.device.findUnique({ where: { userId: dto.toUserId } });
    if (!recipient) throw new NotFoundException('Empfänger hat keine Schlüssel registriert');

    const pending = await this.prisma.keyEnvelope.count({ where: { toUserId: dto.toUserId } });
    if (pending >= MAX_MAILBOX_SIZE) {
      throw new BadRequestException('Mailbox des Empfängers ist voll');
    }

    const envelope = await this.prisma.keyEnvelope.create({
      data: {
        fromUserId,
        toUserId: dto.toUserId,
        payload: dto.payload as unknown as Prisma.InputJsonValue,
      },
    });
    await this.gateway.publishDispatch('KEY_ENVELOPE', { envelope: toEnvelopeInfo(envelope) }, [
      dto.toUserId,
    ]);
  }

  /** Ungelesene Umschläge des Nutzers, älteste zuerst (für den Login-Abgleich). */
  async listEnvelopes(userId: string): Promise<KeyEnvelopeInfo[]> {
    const envelopes = await this.prisma.keyEnvelope.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return envelopes.map(toEnvelopeInfo);
  }

  /** Ack: Empfänger hat den Umschlag verarbeitet → löschen (idempotent). */
  async ackEnvelope(userId: string, envelopeId: string): Promise<void> {
    await this.prisma.keyEnvelope.deleteMany({ where: { id: envelopeId, toUserId: userId } });
  }
}

function toEnvelopeInfo(envelope: KeyEnvelope): KeyEnvelopeInfo {
  return {
    id: envelope.id,
    fromUserId: envelope.fromUserId,
    payload: envelope.payload as unknown as KeyEnvelopePayload,
    createdAt: envelope.createdAt.toISOString(),
  };
}
