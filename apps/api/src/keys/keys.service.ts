import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  cryptoReady,
  DeviceKeyBundle,
  KeyBackupRecord,
  KeyEnvelopeInfo,
  KeyEnvelopePayload,
  verifySignedPreKey,
} from '@parley/shared';
import { KeyBackup, KeyEnvelope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { VisibilityService } from '../gateway/visibility.service';
import { RegisterKeysDto } from './dto/register-keys.dto';
import { SendEnvelopeDto } from './dto/send-envelope.dto';
import { PutBackupBlobDto, PutBackupDto } from './dto/put-backup.dto';

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
    private readonly visibility: VisibilityService,
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
  async getBundle(requesterId: string, userId: string): Promise<DeviceKeyBundle> {
    // Wie die Umschläge (Phase 7) auf den Sichtbarkeitskreis beschränkt –
    // sonst ließe sich per UUID durchprobieren, welche Nutzer existieren.
    // 404 statt 403, damit auch die Antwort nichts über die Existenz verrät.
    if (!(await this.visibility.canSee(requesterId, userId))) {
      throw new NotFoundException('Nutzer hat keine Schlüssel registriert');
    }
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
    // Seit Phase 7: Umschläge nur innerhalb des Sichtbarkeitskreises (Freunde,
    // gemeinsame Server, bestehende DMs) – kein Zustellen an beliebige Fremde.
    if (!(await this.visibility.canSee(fromUserId, dto.toUserId))) {
      throw new ForbiddenException(
        'Schlüssel-Umschläge nur an Freunde oder Mitglieder gemeinsamer Server',
      );
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

  // --- Schlüssel-Backup ------------------------------------------------------
  // Der Server ist hier reiner Ablageort: Salt, Argon2id-Parameter und zwei
  // Ciphertexte. Beim Identitäts-Reset (registerKeys) bleibt das Backup
  // BEWUSST bestehen – es enthält die alte Identität samt History-Schlüsseln;
  // der nächste Passwort-Login stellt sie daraus wieder her.

  /** Eigenes Backup abrufen (404, wenn noch keins eingerichtet wurde). */
  async getBackup(userId: string): Promise<KeyBackupRecord> {
    const backup = await this.prisma.keyBackup.findUnique({ where: { userId } });
    if (!backup) throw new NotFoundException('Kein Schlüssel-Backup vorhanden');
    return toBackupRecord(backup);
  }

  /** Backup einrichten bzw. komplett ersetzen (neuer Master-Key + Blob). */
  async putBackup(userId: string, dto: PutBackupDto): Promise<void> {
    const data = {
      kdfSalt: dto.kdfSalt,
      kdfOpsLimit: dto.kdfOpsLimit,
      kdfMemLimit: dto.kdfMemLimit,
      wrappedKeyNonce: dto.wrappedMasterKey.nonce,
      wrappedKeyCiphertext: dto.wrappedMasterKey.ciphertext,
      blobNonce: dto.blob.nonce,
      blobCiphertext: dto.blob.ciphertext,
    };
    await this.prisma.keyBackup.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  /** Laufende Aktualisierung: nur den Zustands-Blob ersetzen. */
  async putBackupBlob(userId: string, dto: PutBackupBlobDto): Promise<void> {
    const updated = await this.prisma.keyBackup.updateMany({
      where: { userId },
      data: { blobNonce: dto.blob.nonce, blobCiphertext: dto.blob.ciphertext },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Kein Schlüssel-Backup vorhanden – zuerst einrichten');
    }
  }
}

function toBackupRecord(backup: KeyBackup): KeyBackupRecord {
  return {
    kdfSalt: backup.kdfSalt,
    kdfOpsLimit: backup.kdfOpsLimit,
    kdfMemLimit: backup.kdfMemLimit,
    wrappedMasterKey: { nonce: backup.wrappedKeyNonce, ciphertext: backup.wrappedKeyCiphertext },
    blob: { nonce: backup.blobNonce, ciphertext: backup.blobCiphertext },
    updatedAt: backup.updatedAt.toISOString(),
  };
}

function toEnvelopeInfo(envelope: KeyEnvelope): KeyEnvelopeInfo {
  return {
    id: envelope.id,
    fromUserId: envelope.fromUserId,
    payload: envelope.payload as unknown as KeyEnvelopePayload,
    createdAt: envelope.createdAt.toISOString(),
  };
}
