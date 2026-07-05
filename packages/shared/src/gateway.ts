/**
 * Parley-Gateway-Protokoll: eigenes Opcode-Protokoll über WebSocket.
 * Strukturell angelehnt an öffentlich dokumentierte Gateway-Konzepte
 * (Opcodes + Dispatch-Events), aber eigenständig definiert.
 *
 * Ablauf einer Verbindung:
 *   1. Client öffnet  ws(s)://…/gateway
 *   2. Server → HELLO   { heartbeatIntervalMs }
 *   3. Client → IDENTIFY { token }            (Access-Token, JWT)
 *   4. Server → READY   { user, onlineUsers } (Verbindung ist authentifiziert)
 *   5. Client → HEARTBEAT alle heartbeatIntervalMs, Server → HEARTBEAT_ACK
 *   6. Server → DISPATCH { t, d } für Echtzeit-Events (z. B. PRESENCE_UPDATE)
 */

export enum GatewayOpcode {
  /** Server → Client: Echtzeit-Event; `t` benennt das Event, `d` trägt die Daten. */
  Dispatch = 0,
  /** Server → Client: erste Nachricht nach Verbindungsaufbau. */
  Hello = 1,
  /** Client → Server: Authentifizierung mit Access-Token. */
  Identify = 2,
  /** Client → Server: periodisches Lebenszeichen. */
  Heartbeat = 3,
  /** Server → Client: Bestätigung eines Heartbeats. */
  HeartbeatAck = 4,
}

/** WebSocket-Close-Codes des Gateways (4000er-Bereich = anwendungsdefiniert). */
export enum GatewayCloseCode {
  /** Token fehlt, ist ungültig oder abgelaufen. */
  AuthFailed = 4001,
  /** Kein Heartbeat innerhalb der Toleranz → Verbindung gilt als tot. */
  HeartbeatTimeout = 4002,
  /** Nachricht war kein gültiges Protokoll-JSON. */
  InvalidPayload = 4003,
  /** Client hat nicht rechtzeitig IDENTIFY geschickt. */
  IdentifyTimeout = 4004,
}

/** Alle Dispatch-Event-Namen. Wächst mit den Phasen (Messages, Typing, …). */
export type GatewayEventType =
  | 'READY'
  | 'PRESENCE_UPDATE'
  // Phase 3 – Server & Kanäle (gezielt an Server-Mitglieder):
  | 'SERVER_UPDATE'
  | 'SERVER_DELETE'
  | 'SERVER_MEMBER_ADD'
  | 'SERVER_MEMBER_REMOVE'
  | 'CHANNEL_CREATE'
  | 'CHANNEL_UPDATE'
  | 'CHANNEL_DELETE';

/** Envelope für jede Gateway-Nachricht in beide Richtungen. */
export interface GatewayMessage<T = unknown> {
  op: GatewayOpcode;
  /** Event-Name; nur bei op = Dispatch gesetzt. */
  t?: GatewayEventType;
  /** Nutzdaten des Opcodes bzw. Events. */
  d?: T;
}

/** Minimale öffentliche Nutzerdaten für Presence-Zwecke. */
export interface PresenceUser {
  id: string;
  username: string;
}

export interface HelloPayload {
  heartbeatIntervalMs: number;
}

export interface IdentifyPayload {
  /** Access-Token (JWT) aus dem Login. */
  token: string;
}

export interface ReadyPayload {
  /** Der authentifizierte Nutzer dieser Verbindung. */
  user: PresenceUser;
  /** Momentaufnahme aller gerade online verbundenen Nutzer. */
  onlineUsers: PresenceUser[];
}

export interface PresenceUpdatePayload {
  user: PresenceUser;
  online: boolean;
}

// --- Payloads der Server-/Kanal-Events (Phase 3) ---
// Die Typen ServerSummary/ServerMember/ChannelInfo kommen aus ./servers.

export interface ServerDeletePayload {
  serverId: string;
}

export interface ServerMemberRemovePayload {
  serverId: string;
  userId: string;
}

export interface ChannelDeletePayload {
  serverId: string;
  channelId: string;
}
