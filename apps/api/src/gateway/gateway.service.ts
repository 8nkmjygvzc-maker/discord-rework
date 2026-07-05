import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GatewayCloseCode,
  GatewayEventType,
  GatewayMessage,
  GatewayOpcode,
  HelloPayload,
  IdentifyPayload,
  PresenceUpdatePayload,
  PresenceUser,
  ReadyPayload,
} from '@parley/shared';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { parseGatewayMessage } from './gateway.util';
import { PresenceService } from './presence.service';

/** Vom Server vorgegebenes Heartbeat-Intervall (via HELLO an den Client). */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Zeit bis IDENTIFY, sonst wird die Verbindung getrennt. */
const IDENTIFY_TIMEOUT_MS = 10_000;
/** Toleranz: nach 2 verpassten Heartbeats gilt die Verbindung als tot. */
const HEARTBEAT_GRACE_MS = HEARTBEAT_INTERVAL_MS * 2;
/** Redis-Pub/Sub-Kanal, über den alle Gateway-Instanzen Events austauschen. */
const DISPATCH_CHANNEL = 'gateway:dispatch';
/** Obergrenze pro Nachricht – niemand braucht megabytegroße Opcodes. */
const MAX_PAYLOAD_BYTES = 64 * 1024;

interface ConnectionState {
  socket: WebSocket;
  /** null bis zum erfolgreichen IDENTIFY. */
  user: PresenceUser | null;
  /** Timer für Identify- bzw. Heartbeat-Timeout. */
  deadline: NodeJS.Timeout;
}

/**
 * Natives WebSocket-Gateway (Opcode-Protokoll, siehe packages/shared/src/gateway.ts).
 *
 * Events werden NIE direkt an lokale Verbindungen verteilt, sondern immer
 * über Redis publiziert – auch die eigene Instanz empfängt sie über ihr
 * Abonnement. Ein Codepfad, funktioniert unverändert mit N Instanzen.
 */
@Injectable()
export class GatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private wss: WebSocketServer | null = null;
  private readonly connections = new Set<ConnectionState>();

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly presence: PresenceService,
  ) {}

  /** Hängt das Gateway an den HTTP-Server der API (Aufruf aus main.ts nach listen()). */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({
      server,
      path: '/gateway',
      maxPayload: MAX_PAYLOAD_BYTES,
    });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    const subscriber = this.redis.createSubscriber();
    void subscriber.subscribe(DISPATCH_CHANNEL);
    subscriber.on('message', (_channel, message) => this.onRedisDispatch(message));

    this.logger.log('Gateway lauscht auf /gateway');
  }

  /** Publiziert ein Dispatch-Event an alle Gateway-Instanzen (inkl. dieser). */
  async publishDispatch<T>(t: GatewayEventType, d: T): Promise<void> {
    await this.redis.client.publish(DISPATCH_CHANNEL, JSON.stringify({ t, d }));
  }

  private onConnection(socket: WebSocket): void {
    const state: ConnectionState = {
      socket,
      user: null,
      deadline: setTimeout(
        () => socket.close(GatewayCloseCode.IdentifyTimeout, 'IDENTIFY ausgeblieben'),
        IDENTIFY_TIMEOUT_MS,
      ),
    };
    this.connections.add(state);

    this.send(socket, {
      op: GatewayOpcode.Hello,
      d: { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS } satisfies HelloPayload,
    });

    socket.on('message', (raw) => {
      const msg = parseGatewayMessage(String(raw));
      if (!msg) {
        socket.close(GatewayCloseCode.InvalidPayload, 'Ungültige Nachricht');
        return;
      }
      void this.onMessage(state, msg);
    });

    socket.on('close', () => void this.onClose(state));
    socket.on('error', (err) => this.logger.warn(`WS-Fehler: ${err.message}`));
  }

  private async onMessage(state: ConnectionState, msg: GatewayMessage): Promise<void> {
    switch (msg.op) {
      case GatewayOpcode.Identify:
        await this.onIdentify(state, msg.d as IdentifyPayload | undefined);
        return;
      case GatewayOpcode.Heartbeat:
        this.onHeartbeat(state);
        return;
      default:
        // Alles andere (Dispatch, Hello, …) darf nur der Server senden.
        state.socket.close(GatewayCloseCode.InvalidPayload, 'Unerwarteter Opcode');
    }
  }

  private async onIdentify(state: ConnectionState, d: IdentifyPayload | undefined): Promise<void> {
    if (state.user) return; // bereits identifiziert – Doppel-IDENTIFY ignorieren

    let payload: AccessTokenPayload;
    try {
      if (!d?.token) throw new Error('Token fehlt');
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(d.token);
    } catch {
      state.socket.close(GatewayCloseCode.AuthFailed, 'Authentifizierung fehlgeschlagen');
      return;
    }

    state.user = { id: payload.sub, username: payload.username };
    this.armHeartbeatDeadline(state);

    const wasOffline = await this.presence.markOnline(state.user);
    const onlineUsers = await this.presence.getOnlineUsers();

    this.send(state.socket, {
      op: GatewayOpcode.Dispatch,
      t: 'READY',
      d: { user: state.user, onlineUsers } satisfies ReadyPayload,
    });

    if (wasOffline) {
      await this.publishDispatch('PRESENCE_UPDATE', {
        user: state.user,
        online: true,
      } satisfies PresenceUpdatePayload);
    }
  }

  private onHeartbeat(state: ConnectionState): void {
    if (!state.user) {
      // Heartbeat vor IDENTIFY ist Protokollverletzung.
      state.socket.close(GatewayCloseCode.InvalidPayload, 'Nicht identifiziert');
      return;
    }
    this.armHeartbeatDeadline(state);
    void this.presence.refresh(state.user);
    this.send(state.socket, { op: GatewayOpcode.HeartbeatAck });
  }

  private armHeartbeatDeadline(state: ConnectionState): void {
    clearTimeout(state.deadline);
    state.deadline = setTimeout(
      () => state.socket.close(GatewayCloseCode.HeartbeatTimeout, 'Heartbeat ausgeblieben'),
      HEARTBEAT_GRACE_MS,
    );
  }

  private async onClose(state: ConnectionState): Promise<void> {
    clearTimeout(state.deadline);
    this.connections.delete(state);
    if (!state.user) return;

    const wentOffline = await this.presence.markOffline(state.user);
    if (wentOffline) {
      await this.publishDispatch('PRESENCE_UPDATE', {
        user: state.user,
        online: false,
      } satisfies PresenceUpdatePayload);
    }
  }

  /** Verteilt ein über Redis empfangenes Event an alle lokalen, identifizierten Clients. */
  private onRedisDispatch(message: string): void {
    let event: { t: GatewayEventType; d: unknown };
    try {
      event = JSON.parse(message) as { t: GatewayEventType; d: unknown };
    } catch {
      this.logger.warn('Ungültiges Pub/Sub-Event verworfen');
      return;
    }
    const envelope: GatewayMessage = { op: GatewayOpcode.Dispatch, t: event.t, d: event.d };
    for (const conn of this.connections) {
      if (conn.user && conn.socket.readyState === WebSocket.OPEN) {
        this.send(conn.socket, envelope);
      }
    }
  }

  private send(socket: WebSocket, msg: GatewayMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }

  onModuleDestroy(): void {
    for (const conn of this.connections) {
      clearTimeout(conn.deadline);
      conn.socket.close(1001, 'Server fährt herunter');
    }
    this.wss?.close();
  }
}
