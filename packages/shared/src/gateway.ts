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
  | 'CHANNEL_DELETE'
  // Phase 4 – Text-Chat:
  | 'MESSAGE_CREATE'
  // Phase 13 – Nachricht bearbeitet bzw. gelöscht (an dieselben Empfänger
  // wie MESSAGE_CREATE: Server-Mitglieder mit ViewChannels bzw. DM-Partner).
  | 'MESSAGE_UPDATE'
  | 'MESSAGE_DELETE'
  // Phase 13 – Mitglied aktualisiert (aktuell: Timeout gesetzt/aufgehoben).
  | 'SERVER_MEMBER_UPDATE'
  // Phase 15 – NUR an den Betroffenen: du wurdest gekickt/gebannt (mit Grund).
  // Das begleitende SERVER_MEMBER_REMOVE (an alle Mitglieder) trägt bewusst
  // keinen Anlass – Moderationsdetails gehen nur den Betroffenen etwas an.
  | 'SERVER_SELF_REMOVED'
  // Phase 5 – Rollen & Berechtigungen:
  | 'ROLE_CREATE'
  | 'ROLE_UPDATE'
  | 'ROLE_DELETE'
  | 'MEMBER_ROLES_UPDATE'
  // Phase 6 – E2EE: Schlüssel-Umschlag (Sender-Key-Verteilung) zugestellt.
  | 'KEY_ENVELOPE'
  // Phase 7 – Freunde & DMs:
  // Freundesliste hat sich geändert (Anfrage/Annahme/Entfernen/Block) → neu laden.
  | 'FRIENDS_UPDATE'
  // Neuer DM-Kanal; Payload ist pro Empfänger unterschiedlich (otherUser).
  | 'DM_CHANNEL_CREATE'
  // Additiver Presence-Nachschub, wenn der Sichtbarkeitskreis wächst
  // (Server-Beitritt) – Presence ist seit Phase 7 auf Freunde + gemeinsame
  // Server-Mitglieder beschränkt statt global.
  | 'PRESENCE_SYNC'
  // Phase 10 – Sprachchat: Beitritt/Verlassen eines Sprachkanals bzw.
  // Mute-/Deafen-Wechsel (an Server-Mitglieder mit ViewChannels; bei privaten
  // Anrufen an die beiden DM-Teilnehmer).
  | 'VOICE_STATE_UPDATE'
  // Private Anrufe (DM): jemand ruft an (nur an den Angerufenen) bzw. der
  // Angerufene hat abgelehnt (nur an den Anrufer).
  | 'CALL_RING'
  | 'CALL_DECLINE'
  // Soundboard: Sound abspielen (NUR an Nutzer, die gerade im Sprachkanal
  // sitzen) bzw. Bibliothek geändert (an Mitglieder mit ViewChannels).
  | 'SOUNDBOARD_PLAY'
  | 'SOUNDBOARD_UPDATE'
  // Phase 15 – Profil geändert (Status/Avatar): geht an den Sichtbarkeits-
  // kreis + den Nutzer selbst; Clients aktualisieren Mitglieder-/Freundes-/
  // DM-Listen in place.
  | 'USER_UPDATE';

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

/** Profilaktualisierung (Status/Avatar, Phase 15) – Form wie PublicUser. */
export interface UserUpdatePayload {
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
    status: string;
  };
}

/** Nachträglich sichtbar gewordene Online-Nutzer (additiv zum Client-Stand). */
export interface PresenceSyncPayload {
  users: PresenceUser[];
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

// --- Payloads der Moderations-Events (Phase 13) ---

export interface MessageDeletePayload {
  channelId: string;
  messageId: string;
}

/**
 * Rückmeldung an ein gekicktes/gebanntes Mitglied (Phase 15). Der Servername
 * reist mit, weil der Client den Server beim Eintreffen bereits aus seiner
 * Liste entfernt hat (SERVER_MEMBER_REMOVE) und ihn nicht mehr auflösen kann.
 */
export interface ServerSelfRemovedPayload {
  serverId: string;
  serverName: string;
  cause: 'kick' | 'ban';
  reason: string | null;
}
