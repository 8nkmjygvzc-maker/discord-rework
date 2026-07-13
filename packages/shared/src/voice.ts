/**
 * Phase 10 – Sprachchat. Zwei getrennte Signaling-Ebenen:
 *
 *  1. ROSTER / STATE  (REST + bestehendes Gateway):
 *     Beitreten/Verlassen eines Sprachkanals, Mute/Deafen und die Frage
 *     „wer sitzt gerade in welchem Sprachkanal“. Die API ist die Autorität
 *     für diesen Zustand (VoiceSession-Tabelle) und verteilt ihn per
 *     VOICE_STATE_UPDATE an die Server-Mitglieder.
 *
 *  2. MEDIA  (direkte WebSocket zum mediasoup-SFU, `apps/voice`):
 *     WebRTC-Transport-Aushandlung (Router-RTP-Capabilities, Transporte,
 *     Produce/Consume). Authentifiziert per kurzlebigem Voice-Token, das die
 *     API beim Beitritt ausstellt – der SFU braucht keinen DB-Zugriff.
 *
 * Voice ist zunächst nur transportverschlüsselt (DTLS-SRTP über den SFU);
 * echte Medien-E2EE (Insertable Streams) steht in der ROADMAP.
 */

// --- Ebene 1: Roster/State (über REST + Gateway) -----------------------------

/**
 * Quelle eines Medien-Producers (Phase 10/11). `mic` = Mikrofon (Audio),
 * `cam` = Kamera-Video, `screen` = Bildschirmfreigabe (Video). Wird als
 * appData am mediasoup-Producer geführt, damit Clients Kamera von Screen-Share
 * unterscheiden und richtig rendern können.
 */
export type VoiceSource = 'mic' | 'cam' | 'screen';

/** Zustand eines Nutzers in einem Sprachkanal (Teil von ServerDetails). */
export interface VoiceState {
  channelId: string;
  userId: string;
  username: string;
  /** Mikrofon stummgeschaltet (produziert nicht bzw. pausiert). */
  muted: boolean;
  /** Deafen: hört niemanden (impliziert stumm). */
  deafened: boolean;
  /** Kamera aktiv (Phase 11). */
  cameraOn: boolean;
  /** Bildschirmfreigabe aktiv (Phase 11). */
  screenOn: boolean;
}

/**
 * Gateway-Event VOICE_STATE_UPDATE. `state === null` bedeutet: der Nutzer hat
 * den Sprachkanal verlassen. Geht an alle Mitglieder des Servers mit
 * ViewChannels (wie MESSAGE_CREATE); bei privaten Anrufen (DM-Kanäle,
 * `serverId === null`) an die beiden Teilnehmer.
 */
export interface VoiceStateUpdatePayload {
  channelId: string;
  /** null = DM-Kanal (privater Anruf) – Clients pflegen dann den Anruf-Roster. */
  serverId: string | null;
  userId: string;
  username: string;
  state: { muted: boolean; deafened: boolean; cameraOn: boolean; screenOn: boolean } | null;
}

/** Gateway-Event CALL_RING: eingehender privater Anruf (nur an den Angerufenen). */
export interface CallRingPayload {
  channelId: string;
  caller: { id: string; username: string; avatarUrl: string | null };
}

/** Gateway-Event CALL_DECLINE: der Angerufene hat abgelehnt (nur an den Anrufer). */
export interface CallDeclinePayload {
  channelId: string;
  userId: string;
  username: string;
}

/** Antwort auf POST /api/voice/channels/:id/join. */
export interface VoiceJoinResponse {
  /** Kurzlebiges Token (JWT) zur Authentifizierung an der Voice-WebSocket. */
  voiceToken: string;
  /** WebSocket-URL des SFU (im Dev per Vite-Proxy: `/voice`). */
  voiceUrl: string;
  /** Kanal, dem beigetreten wurde (Bestätigung). */
  channelId: string;
}

/** Body von PATCH /api/voice/channels/:id/state. */
export interface VoiceStateChangeRequest {
  muted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  screenOn: boolean;
}

// --- Ebene 2: Medien-Signaling (Client ⇄ SFU über WebSocket) -----------------
//
// mediasoup-spezifische Wire-Objekte (RtpCapabilities, RtpParameters,
// DtlsParameters, IceParameters/Candidates …) werden hier bewusst als
// opake `unknown`/JSON durchgereicht: `@parley/shared` soll nicht von
// mediasoup abhängen. Voice-Service und Web-Client casten sie zu den
// jeweiligen mediasoup-Typen.

/** Frei gewählte, opake JSON-Struktur (mediasoup-Wire-Objekt). */
export type Json = unknown;

/** Nachrichten Client → SFU. `rid` korreliert Anfrage und Antwort. */
export type VoiceClientMessage =
  /** Erste Nachricht: Authentifizierung mit dem Voice-Token. */
  | { op: 'auth'; token: string }
  /** RTP-Capabilities des Routers holen (zum Laden des mediasoup-Device). */
  | { op: 'getRtpCapabilities'; rid: number }
  /** WebRTC-Transport erzeugen (send = eigenes Mikro, recv = andere hören). */
  | { op: 'createTransport'; rid: number; direction: 'send' | 'recv' }
  /** DTLS-Parameter nach dem lokalen Aufbau nachreichen. */
  | { op: 'connectTransport'; rid: number; transportId: string; dtlsParameters: Json }
  /**
   * Eigenen Medien-Track produzieren. `source` unterscheidet Mikrofon (audio),
   * Kamera-Video und Bildschirmfreigabe (beide video) – wird als appData am
   * mediasoup-Producer geführt und an die anderen Teilnehmer weitergereicht.
   */
  | {
      op: 'produce';
      rid: number;
      transportId: string;
      kind: 'audio' | 'video';
      source: VoiceSource;
      rtpParameters: Json;
    }
  /** Fremden Producer konsumieren. */
  | { op: 'consume'; rid: number; producerId: string; rtpCapabilities: Json }
  /** Consumer nach Empfang der Parameter fortsetzen (mediasoup startet pausiert). */
  | { op: 'resumeConsumer'; rid: number; consumerId: string }
  /** Eigenen Producer pausieren/fortsetzen (Mute). */
  | { op: 'pauseProducer'; rid: number; producerId: string }
  | { op: 'resumeProducer'; rid: number; producerId: string }
  /**
   * Eigenen Producer endgültig schließen (Kamera aus / Screen-Share beenden).
   * Anders als pauseProducer verschwindet der Stream bei den anderen ganz.
   */
  | { op: 'closeProducer'; rid: number; producerId: string }
  /** Liste der bereits vorhandenen Producer (zum Konsumieren beim Beitritt). */
  | { op: 'getProducers'; rid: number };

/** Ein fremder Producer im selben Sprachkanal. */
export interface VoiceProducerInfo {
  producerId: string;
  peerId: string;
  userId: string;
  username: string;
  kind: 'audio' | 'video';
  /** Mikrofon, Kamera oder Bildschirmfreigabe (bestimmt das Rendering). */
  source: VoiceSource;
}

/** Nachrichten SFU → Client. Antworten tragen `rid`, Benachrichtigungen nicht. */
export type VoiceServerMessage =
  /** Auth erfolgreich; `peerId` ist die SFU-interne Kennung dieser Verbindung. */
  | { op: 'welcome'; peerId: string; userId: string }
  /** Auth fehlgeschlagen; Verbindung wird danach geschlossen. */
  | { op: 'authError'; reason: string }
  /** Generische Erfolgsantwort mit optionalen Daten (per rid zugeordnet). */
  | { op: 'response'; rid: number; data: Json }
  /** Fehlerantwort auf eine Anfrage. */
  | { op: 'error'; rid: number; message: string }
  /** Ein anderer Teilnehmer hat einen neuen Producer angelegt. */
  | { op: 'newProducer'; producer: VoiceProducerInfo }
  /** Ein Producer wurde geschlossen (Stumm-Beenden, Verlassen). */
  | { op: 'producerClosed'; producerId: string; peerId: string }
  /** Ein Teilnehmer hat den Sprachkanal verlassen. */
  | { op: 'peerLeft'; peerId: string; userId: string };

/** Claims des Voice-Tokens (von der API signiert, vom SFU verifiziert). */
export interface VoiceTokenClaims {
  sub: string;
  username: string;
  channelId: string;
  purpose: 'voice';
}
