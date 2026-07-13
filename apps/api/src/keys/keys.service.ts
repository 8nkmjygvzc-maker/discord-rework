import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  cryptoReady,
  DeviceKeyBundle,
  ENVELOPE_RETENTION_DAYS,
  KeyBackupInfo,
  KeyEnvelopeInfo,
  KeyEnvelopePayload,
  verifySignedPreKey,
} from '@parley/shared';
import { KeyEnvelope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { VisibilityService } from '../gateway/visibility.service';
import { RegisterKeysDto } from './dto/register-keys.dto';
import { SaveKeyBackupDto } from './dto/save-key-backup.dto';
import { SendEnvelopeDto } from './dto/send-envelope.dto';

/** Obergrenze für Umschläge – eine Sender-Key-Verteilung ist < 2 KiB. */
const MAX_ENVELOPE_BYTES = 16 * 1024;
/** Mailbox-Limit pro Empfänger – schützt vor Zumüllen durch einen Angreifer. */
const MAX_MAILBOX_SIZE = 1000;
/** Backup-Blob-Limit (Identität + Prekey sind < 2 KiB, großzügig bemessen). */
const MAX_BACKUP_BYTES = 16 * 1024;

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
   * Registriert bzw. erneuert die veröffentlichten Schlüssel des Accounts.
   * Seit dem Multi-Browser-Support teilen sich alle Browser eines Accounts
   * über das Schlüssel-Backup dieselbe Identität; ein Identitätswechsel kommt
   * nur noch während der Migration bzw. nach einem Backup-Reset vor. Umschläge
   * werden dabei bewusst NICHT mehr gelöscht: An die (Backup-)Identität
   * gerichtete Umschläge bleiben für andere Browser lesbar, unlesbare laufen
   * über die Retention-Frist ohnehin ab.
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
    await this.prisma.device.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto },
    });
  }

  /** Verschlüsseltes Schlüssel-Backup des Nutzers (404, wenn keins existiert). */
  async getBackup(userId: string): Promise<KeyBackupInfo> {
    const backup = await this.prisma.keyBackup.findUnique({ where: { userId } });
    if (!backup) throw new NotFoundException('Kein Schlüssel-Backup vorhanden');
    return {
      salt: backup.salt,
      nonce: backup.nonce,
      ciphertext: backup.ciphertext,
      updatedAt: backup.updatedAt.toISOString(),
    };
  }

  /**
   * Schlüssel-Backup speichern. `onlyIfMissing` schützt den Erst-Upload: Wenn
   * zwei Browser gleichzeitig ihr erstes Backup hochladen, gewinnt genau
   * einer – der andere bekommt 409, lädt das gespeicherte Backup und
   * übernimmt dessen Identität.
   */
  async saveBackup(userId: string, dto: SaveKeyBackupDto): Promise<void> {
    if (dto.salt.length + dto.nonce.length + dto.ciphertext.length > MAX_BACKUP_BYTES) {
      throw new BadRequestException('Schlüssel-Backup ist zu groß');
    }
    const data = { salt: dto.salt, nonce: dto.nonce, ciphertext: dto.ciphertext };
    if (dto.onlyIfMissing) {
      try {
        await this.prisma.keyBackup.create({ data: { userId, ...data } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Es existiert bereits ein Schlüssel-Backup');
        }
        throw err;
      }
      return;
    }
    await this.prisma.keyBackup.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
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

  /**
   * Umschläge des Nutzers, älteste zuerst (für den Login-Abgleich). Seit dem
   * Multi-Browser-Support bleiben Umschläge bis zum Ablauf der Retention
   * liegen (JEDER Browser des Accounts muss sie lesen können, welche er schon
   * verarbeitet hat, merkt sich der Client selbst); Abgelaufenes wird hier
   * nebenbei aufgeräumt.
   */
  async listEnvelopes(userId: string): Promise<KeyEnvelopeInfo[]> {
    const cutoff = new Date(Date.now() - ENVELOPE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.keyEnvelope.deleteMany({
      where: { toUserId: userId, createdAt: { lt: cutoff } },
    });
    const envelopes = await this.prisma.keyEnvelope.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'asc' },
      take: MAX_MAILBOX_SIZE,
    });
    return envelopes.map(toEnvelopeInfo);
  }

  /**
   * Ack eines Umschlags – seit dem Multi-Browser-Support bewusst ein No-op:
   * Andere Browser desselben Accounts brauchen den Umschlag noch, gelöscht
   * wird erst über die Retention (listEnvelopes). Der Endpunkt bleibt für
   * ältere Clients bestehen, damit deren Acks nichts kaputt machen.
   */
  ackEnvelope(_userId: string, _envelopeId: string): Promise<void> {
    return Promise.resolve();
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
