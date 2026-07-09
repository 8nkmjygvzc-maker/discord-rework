import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  Permissions,
  VoiceJoinResponse,
  VoiceStateUpdatePayload,
  VoiceTokenClaims,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { RedisService } from '../redis/redis.service';
import { VoiceStateDto } from './dto/voice-state.dto';

/** Gültigkeit des Voice-Tokens – nur der WS-Handshake zum SFU muss abgedeckt sein. */
const VOICE_TOKEN_TTL = '120s';
/**
 * Redis-Kanal, über den der SFU-Service meldet, dass die Medien-WebSocket eines
 * Clients geschlossen wurde (auch bei Absturz). Payload: { userId, channelId }.
 */
const VOICE_DISCONNECT_CHANNEL = 'voice:disconnect';
/**
 * Redis-Kanal, über den die API den SFU anweist, die Medien-WS eines Nutzers zu
 * schließen (Voice-Moderation, Phase 13). Payload: { userId, channelId }.
 */
const VOICE_FORCE_DISCONNECT_CHANNEL = 'voice:force-disconnect';
/**
 * Liveness-Keys, die der SFU pro verbundenem Peer setzt (Phase 14) – muss zum
 * Präfix in `apps/voice/src/main.ts` passen. Fehlt der Key, hat die Session
 * keinen lebenden Medien-Peer mehr.
 */
const VOICE_PEER_KEY_PREFIX = 'voice:peer:';
/** Abgleich-Intervall des Rosters mit den SFU-Liveness-Keys. */
const RECONCILE_INTERVAL_MS = 30_000;
/**
 * Karenz für frische Beitritte: zwischen `join` (Session angelegt) und dem
 * SFU-Welcome (Liveness-Key gesetzt) darf der Abgleich noch nicht aufräumen.
 */
const RECONCILE_JOIN_GRACE_MS = 30_000;

/**
 * Phase 10 – Roster-Autorität für Sprachkanäle. Die API besitzt den Zustand
 * „wer sitzt in welchem Sprachkanal“ (VoiceSession) und verteilt ihn per
 * VOICE_STATE_UPDATE. Die eigentliche Medien-Aushandlung läuft separat über den
 * SFU-Service (apps/voice); dieser meldet Trennungen via Redis zurück, damit
 * das Roster auch bei Client-Abstürzen konsistent bleibt.
 */
@Injectable()
export class VoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceService.name);
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const subscriber = this.redis.createSubscriber();
    await subscriber.subscribe(VOICE_DISCONNECT_CHANNEL);
    subscriber.on('message', (_channel, message) => void this.onSfuDisconnect(message));

    // Roster mit den SFU-Liveness-Keys abgleichen (Phase 14): Sessions ohne
    // lebenden Medien-Peer räumen – multi-instanz- und crash-fest. Ersetzt das
    // frühere „beim Start ALLE Sessions löschen“, das in Multi-Instanz die
    // Sessions noch verbundener Nutzer anderer Instanzen mitgerissen hätte.
    await this.reconcileRoster();
    this.reconcileTimer = setInterval(() => {
      void this.reconcileRoster().catch((err: unknown) =>
        this.logger.warn(`Voice-Roster-Abgleich fehlgeschlagen: ${String(err)}`),
      );
    }, RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  /**
   * Gleicht den Postgres-Roster mit den SFU-Liveness-Keys ab und entfernt
   * Sessions ohne lebenden Medien-Peer (mit Beitritts-Karenz). Kleine Tabelle
   * (ein Eintrag pro Nutzer im Voice) – ein voller Scan ist hier unkritisch.
   */
  private async reconcileRoster(): Promise<void> {
    const sessions = await this.prisma.voiceSession.findMany({
      include: {
        user: { select: { username: true } },
        channel: { select: { serverId: true } },
      },
    });
    if (sessions.length === 0) return;

    const pipeline = this.redis.client.pipeline();
    for (const s of sessions) pipeline.exists(VOICE_PEER_KEY_PREFIX + s.userId);
    const results = (await pipeline.exec()) ?? [];

    const graceCutoff = Date.now() - RECONCILE_JOIN_GRACE_MS;
    let removed = 0;
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const alive = results[i]?.[1] === 1;
      if (alive || session.joinedAt.getTime() > graceCutoff) continue;
      await this.removeSession(session.channelId, session.userId, session.user.username);
      removed += 1;
    }
    if (removed > 0) this.logger.log(`${removed} verwaiste Voice-Session(s) abgeglichen`);
  }

  /**
   * Betritt einen Sprachkanal: Rechte prüfen, ggf. aus dem alten Kanal austreten
   * (ein Nutzer = ein Sprachkanal), VoiceSession anlegen, Roster verteilen und
   * ein kurzlebiges Voice-Token für den SFU ausstellen.
   */
  async join(userId: string, username: string, channelId: string): Promise<VoiceJoinResponse> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel || !channel.serverId || channel.type !== 'VOICE') {
      throw new NotFoundException('Sprachkanal nicht gefunden');
    }
    // Beitreten verlangt (wie Lesen) ViewChannels – wirft 404 für Nicht-Mitglieder,
    // 403 ohne Recht. Eigene Connect/Speak-Rechte kommen später (siehe ROADMAP).
    await this.permissions.requirePermission(channel.serverId, userId, Permissions.ViewChannels);

    // Auszeit (Phase 13): blockiert auch den Beitritt zu Sprachkanälen.
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId: channel.serverId } },
      select: { timeoutUntil: true },
    });
    if (membership?.timeoutUntil && membership.timeoutUntil.getTime() > Date.now()) {
      throw new ForbiddenException('Du bist in Auszeit und kannst keinem Sprachkanal beitreten');
    }

    // In einem anderen Sprachkanal? Erst dort sauber austreten (Kanalwechsel).
    const existing = await this.prisma.voiceSession.findUnique({ where: { userId } });
    if (existing && existing.channelId !== channelId) {
      await this.removeSession(existing.channelId, userId, username);
    }

    // Upsert = idempotent: deckt Erstbeitritt UND Reconnect-Rejoin ab; Mute/
    // Deafen/Kamera/Screen werden beim (Neu-)Beitritt zurückgesetzt.
    await this.prisma.voiceSession.upsert({
      where: { userId },
      create: {
        userId,
        channelId,
        muted: false,
        deafened: false,
        cameraOn: false,
        screenOn: false,
      },
      update: {
        channelId,
        muted: false,
        deafened: false,
        cameraOn: false,
        screenOn: false,
        joinedAt: new Date(),
      },
    });

    await this.broadcast(channel.serverId, {
      channelId,
      userId,
      username,
      state: { muted: false, deafened: false, cameraOn: false, screenOn: false },
    });

    const claims: VoiceTokenClaims = { sub: userId, username, channelId, purpose: 'voice' };
    const voiceToken = await this.jwt.signAsync(claims, { expiresIn: VOICE_TOKEN_TTL });
    return {
      voiceToken,
      voiceUrl: this.config.get<string>('VOICE_PUBLIC_URL') ?? '/voice',
      channelId,
    };
  }

  /** Verlässt den Sprachkanal (nur wenn die aktuelle Session zu diesem Kanal gehört). */
  async leave(userId: string, username: string, channelId: string): Promise<void> {
    const session = await this.prisma.voiceSession.findUnique({ where: { userId } });
    if (!session || session.channelId !== channelId) return;
    await this.removeSession(channelId, userId, username);
  }

  /**
   * Selbst gemeldeten Zustand aktualisieren: Mute/Deafen (Deafen impliziert
   * Mute) sowie Kamera-/Bildschirm-Anzeige (Phase 11). Der Server vertraut dem
   * Client – die tatsächlichen Medien werden vom SFU verwaltet.
   */
  async updateState(
    userId: string,
    username: string,
    channelId: string,
    dto: VoiceStateDto,
  ): Promise<void> {
    const session = await this.prisma.voiceSession.findUnique({
      where: { userId },
      include: { channel: { select: { serverId: true } } },
    });
    if (!session || session.channelId !== channelId || !session.channel.serverId) {
      throw new NotFoundException('Keine aktive Sprachsitzung in diesem Kanal');
    }
    const muted = dto.muted || dto.deafened;
    const deafened = dto.deafened;
    const cameraOn = dto.cameraOn;
    const screenOn = dto.screenOn;
    await this.prisma.voiceSession.update({
      where: { userId },
      data: { muted, deafened, cameraOn, screenOn },
    });
    await this.broadcast(session.channel.serverId, {
      channelId,
      userId,
      username,
      state: { muted, deafened, cameraOn, screenOn },
    });
  }

  /**
   * Voice-Moderation (Phase 13): trennt einen Nutzer aus dem Sprachkanal – aber
   * nur, wenn seine Session zu einem Kanal DIESES Servers gehört. Weist den SFU
   * an, die Medien-WS zu schließen, und räumt Roster/Session. Liefert false,
   * wenn der Nutzer in keinem Sprachkanal des Servers sitzt.
   */
  async forceDisconnect(userId: string, serverId: string): Promise<boolean> {
    const session = await this.prisma.voiceSession.findUnique({
      where: { userId },
      include: {
        user: { select: { username: true } },
        channel: { select: { serverId: true } },
      },
    });
    if (!session || session.channel.serverId !== serverId) return false;
    // SFU anweisen, die Medien-WS zu schließen (der SFU meldet die Trennung
    // ohnehin zurück; removeSession räumt den Roster idempotent sofort).
    await this.redis.client.publish(
      VOICE_FORCE_DISCONNECT_CHANNEL,
      JSON.stringify({ userId, channelId: session.channelId }),
    );
    await this.removeSession(session.channelId, userId, session.user.username);
    return true;
  }

  // --- intern ---------------------------------------------------------------

  /** SFU meldet: Medien-WS eines Clients geschlossen → Session räumen. */
  private async onSfuDisconnect(message: string): Promise<void> {
    let payload: { userId?: string; channelId?: string };
    try {
      payload = JSON.parse(message) as { userId?: string; channelId?: string };
    } catch {
      this.logger.warn('Ungültiges voice:disconnect-Signal verworfen');
      return;
    }
    if (!payload.userId || !payload.channelId) return;

    const session = await this.prisma.voiceSession.findUnique({
      where: { userId: payload.userId },
      include: { user: { select: { username: true } } },
    });
    // Nur räumen, wenn die aktuelle Session noch zu diesem Kanal gehört – nach
    // einem schnellen Kanalwechsel darf ein spätes Signal die neue nicht löschen.
    if (!session || session.channelId !== payload.channelId) return;
    await this.removeSession(payload.channelId, payload.userId, session.user.username);
  }

  /** Löscht die Session eines Nutzers in einem Kanal und meldet den Austritt. */
  private async removeSession(channelId: string, userId: string, username: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });
    // deleteMany statt delete: idempotent, wirft nicht, falls schon weg.
    const deleted = await this.prisma.voiceSession.deleteMany({ where: { userId, channelId } });
    if (deleted.count === 0 || !channel?.serverId) return;
    await this.broadcast(channel.serverId, { channelId, userId, username, state: null });
  }

  /** VOICE_STATE_UPDATE an alle Server-Mitglieder mit ViewChannels (wie MESSAGE_CREATE). */
  private async broadcast(serverId: string, payload: VoiceStateUpdatePayload): Promise<void> {
    const recipients = await this.permissions.getMemberIdsWithPermission(
      serverId,
      Permissions.ViewChannels,
    );
    await this.gateway.publishDispatch('VOICE_STATE_UPDATE', payload, recipients);
  }
}
