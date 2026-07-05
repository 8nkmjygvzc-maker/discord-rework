import {
  GatewayCloseCode,
  GatewayMessage,
  GatewayOpcode,
  HelloPayload,
  IdentifyPayload,
  PresenceUpdatePayload,
  ReadyPayload,
} from '@parley/shared';

export interface GatewayHandlers {
  /**
   * Liefert ein Access-Token für IDENTIFY. Bei forceRefresh MUSS ein frisches
   * Token beschafft werden (der Server hat das alte gerade abgelehnt).
   * null = keine Sitzung mehr → Client stoppt.
   */
  getToken: (forceRefresh: boolean) => Promise<string | null>;
  onReady: (d: ReadyPayload) => void;
  onPresenceUpdate: (d: PresenceUpdatePayload) => void;
  onConnectionChange: (connected: boolean) => void;
}

/** Obergrenze für den Reconnect-Backoff. */
const MAX_BACKOFF_MS = 30_000;

/**
 * WebSocket-Client für das Parley-Gateway (Protokoll: packages/shared/src/gateway.ts).
 * Kümmert sich um IDENTIFY, Heartbeats und automatischen Reconnect mit
 * exponentiellem Backoff. Lebensdauer: start() nach Login, stop() beim Logout.
 */
export class GatewayClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private awaitingAck = false;
  private reconnectAttempts = 0;
  private authFailed = false;
  private stopped = true;

  constructor(private readonly handlers: GatewayHandlers) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.authFailed = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, 'Client beendet');
    this.socket = null;
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/gateway`);
    this.socket = socket;

    socket.onmessage = (e) => {
      void this.onMessage(JSON.parse(String(e.data)) as GatewayMessage);
    };
    socket.onclose = (e) => this.onClose(e);
  }

  private async onMessage(msg: GatewayMessage): Promise<void> {
    switch (msg.op) {
      case GatewayOpcode.Hello: {
        const token = await this.handlers.getToken(this.authFailed);
        if (!token) {
          this.stop();
          return;
        }
        this.authFailed = false;
        this.send({ op: GatewayOpcode.Identify, d: { token } satisfies IdentifyPayload });
        this.startHeartbeat((msg.d as HelloPayload).heartbeatIntervalMs);
        return;
      }
      case GatewayOpcode.HeartbeatAck:
        this.awaitingAck = false;
        return;
      case GatewayOpcode.Dispatch:
        if (msg.t === 'READY') {
          this.reconnectAttempts = 0;
          this.handlers.onConnectionChange(true);
          this.handlers.onReady(msg.d as ReadyPayload);
        } else if (msg.t === 'PRESENCE_UPDATE') {
          this.handlers.onPresenceUpdate(msg.d as PresenceUpdatePayload);
        }
        return;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.awaitingAck = false;
    this.heartbeatTimer = setInterval(() => {
      if (this.awaitingAck) {
        // Kein ACK auf den letzten Heartbeat → Verbindung ist tot.
        // close() löst onclose und damit den Reconnect aus.
        this.socket?.close();
        return;
      }
      this.awaitingAck = true;
      this.send({ op: GatewayOpcode.Heartbeat });
    }, intervalMs);
  }

  private onClose(e: CloseEvent): void {
    this.clearTimers();
    this.handlers.onConnectionChange(false);
    if (this.stopped) return;

    // Abgelehnte Auth: beim nächsten Versuch ein frisches Token erzwingen.
    if (e.code === (GatewayCloseCode.AuthFailed as number)) this.authFailed = true;

    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  private send(msg: GatewayMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }
}
