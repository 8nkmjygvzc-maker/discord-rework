import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import type { types } from 'mediasoup';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  VoiceClientMessage,
  VoiceProducerInfo,
  VoiceServerMessage,
  VoiceSource,
  VoiceTokenClaims,
} from '@parley/shared';
import { config } from './config';
import { MediasoupManager } from './mediasoup-manager';
import { Peer, Room } from './room';

/** Zeit bis zur ersten `auth`-Nachricht, sonst wird die Verbindung geschlossen. */
const AUTH_TIMEOUT_MS = 10_000;

/** Wird über Redis publiziert, wenn die Medien-WS eines Nutzers endet. */
export type DisconnectPublisher = (userId: string, channelId: string) => void;

/**
 * Signaling-WebSocket des SFU. Pro Verbindung: erst `auth` (Voice-Token),
 * danach die mediasoup-Aushandlung (RTP-Capabilities, Transporte, Produce/
 * Consume). Beim Trennen wird der API-Roster per Redis benachrichtigt.
 */
export class SignalingServer {
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly mediasoup: MediasoupManager,
    private readonly publishDisconnect: DisconnectPublisher,
  ) {}

  /** Eigener HTTP-Server (damit ws und ein Health-Endpunkt koexistieren). */
  attach(server: HttpServer): void {
    this.wss = new WebSocketServer({ server, path: '/voice', maxPayload: 256 * 1024 });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  private onConnection(socket: WebSocket): void {
    let peer: Peer | null = null;

    const authTimer = setTimeout(() => {
      if (!peer) socket.close(4001, 'Auth ausgeblieben');
    }, AUTH_TIMEOUT_MS);

    socket.on('message', (raw) => {
      let msg: VoiceClientMessage;
      try {
        msg = JSON.parse(String(raw)) as VoiceClientMessage;
      } catch {
        socket.close(4003, 'Ungültige Nachricht');
        return;
      }

      if (!peer) {
        if (msg.op !== 'auth') {
          socket.close(4002, 'Nicht authentifiziert');
          return;
        }
        clearTimeout(authTimer);
        void this.onAuth(socket, msg.token).then((p) => {
          peer = p;
        });
        return;
      }

      void this.onRequest(peer, msg);
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      if (peer) this.onPeerGone(peer);
    });
    socket.on('error', () => {
      /* Fehler führt ohnehin zu close – hier nichts weiter zu tun. */
    });
  }

  // --- Auth -----------------------------------------------------------------

  private async onAuth(socket: WebSocket, token: string): Promise<Peer | null> {
    let claims: VoiceTokenClaims;
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as VoiceTokenClaims;
      if (decoded.purpose !== 'voice' || !decoded.sub || !decoded.channelId) {
        throw new Error('Kein Voice-Token');
      }
      claims = decoded;
    } catch {
      send(socket, { op: 'authError', reason: 'Ungültiges oder abgelaufenes Token' });
      socket.close(4001, 'Auth fehlgeschlagen');
      return null;
    }

    const room = await this.mediasoup.getOrCreateRoom(claims.channelId);

    // Bereits ein Peer desselben Nutzers im Raum? Alte Verbindung ersetzen
    // (zweiter Tab / Reconnect) – ohne fälschliches Trenn-Signal an die API.
    for (const existing of room.peers.values()) {
      if (existing.userId === claims.sub) {
        existing.replaced = true;
        existing.socket.close(4005, 'Durch neue Verbindung ersetzt');
      }
    }

    const peer = new Peer(socket, claims.sub, claims.username, claims.channelId);
    room.peers.set(peer.id, peer);
    send(socket, { op: 'welcome', peerId: peer.id, userId: peer.userId });
    return peer;
  }

  // --- Anfragen (nach Auth) -------------------------------------------------

  private async onRequest(peer: Peer, msg: VoiceClientMessage): Promise<void> {
    if (msg.op === 'auth') return; // Doppel-Auth ignorieren
    const room = this.mediasoup.getRoom(peer.channelId);
    if (!room) {
      send(peer.socket, { op: 'error', rid: msg.rid, message: 'Raum existiert nicht mehr' });
      return;
    }
    try {
      const data = await this.handle(room, peer, msg);
      send(peer.socket, { op: 'response', rid: msg.rid, data });
    } catch (err) {
      send(peer.socket, {
        op: 'error',
        rid: msg.rid,
        message: err instanceof Error ? err.message : 'Interner Fehler',
      });
    }
  }

  private async handle(
    room: Room,
    peer: Peer,
    msg: Exclude<VoiceClientMessage, { op: 'auth' }>,
  ): Promise<unknown> {
    switch (msg.op) {
      case 'getRtpCapabilities':
        return room.router.rtpCapabilities;

      case 'createTransport': {
        const transport = await this.mediasoup.createWebRtcTransport(room.router);
        peer.transports.set(transport.id, transport);
        if (msg.direction === 'send') peer.sendTransportId = transport.id;
        else peer.recvTransportId = transport.id;
        transport.on('dtlsstatechange', (state) => {
          if (state === 'failed' || state === 'closed') transport.close();
        });
        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      }

      case 'connectTransport': {
        const transport = peer.transports.get(msg.transportId);
        if (!transport) throw new Error('Transport unbekannt');
        await transport.connect({ dtlsParameters: msg.dtlsParameters as types.DtlsParameters });
        return { connected: true };
      }

      case 'produce': {
        const transport = peer.transports.get(msg.transportId);
        if (!transport) throw new Error('Transport unbekannt');
        // Die Quelle (mic/cam/screen) am Producer festhalten, damit newProducer
        // und getProducers sie mitliefern und Clients richtig rendern.
        const producer = await transport.produce({
          kind: msg.kind,
          rtpParameters: msg.rtpParameters as types.RtpParameters,
          appData: { source: msg.source },
        });
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
          peer.producers.delete(producer.id);
        });
        // Anderen Teilnehmern den neuen Producer melden (sie konsumieren ihn).
        this.notifyOthers(room, peer.id, {
          op: 'newProducer',
          producer: producerInfo(producer, peer),
        });
        return { producerId: producer.id };
      }

      case 'consume': {
        if (!peer.recvTransportId) throw new Error('Kein Recv-Transport');
        const transport = peer.transports.get(peer.recvTransportId);
        if (!transport) throw new Error('Recv-Transport unbekannt');
        const found = room.findProducer(msg.producerId);
        if (!found) throw new Error('Producer unbekannt');
        const rtpCapabilities = msg.rtpCapabilities as types.RtpCapabilities;
        if (!room.router.canConsume({ producerId: msg.producerId, rtpCapabilities })) {
          throw new Error('Kann diesen Producer nicht konsumieren');
        }
        // Pausiert erstellen – der Client setzt fort, sobald er bereit ist
        // (empfohlenes mediasoup-Muster gegen verlorene erste Pakete).
        const consumer = await transport.consume({
          producerId: msg.producerId,
          rtpCapabilities,
          paused: true,
        });
        peer.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
        consumer.on('producerclose', () => {
          peer.consumers.delete(consumer.id);
          send(peer.socket, {
            op: 'producerClosed',
            producerId: msg.producerId,
            peerId: found.peer.id,
          });
        });
        return {
          id: consumer.id,
          producerId: msg.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };
      }

      case 'resumeConsumer': {
        const consumer = peer.consumers.get(msg.consumerId);
        if (!consumer) throw new Error('Consumer unbekannt');
        await consumer.resume();
        return { resumed: true };
      }

      case 'pauseProducer': {
        const producer = peer.producers.get(msg.producerId);
        if (!producer) throw new Error('Producer unbekannt');
        await producer.pause();
        return { paused: true };
      }

      case 'resumeProducer': {
        const producer = peer.producers.get(msg.producerId);
        if (!producer) throw new Error('Producer unbekannt');
        await producer.resume();
        return { resumed: true };
      }

      case 'closeProducer': {
        const producer = peer.producers.get(msg.producerId);
        if (!producer) throw new Error('Producer unbekannt');
        producer.close();
        peer.producers.delete(msg.producerId);
        // Consumer der anderen feuern 'producerclose' und melden es selbst; wir
        // benachrichtigen zusätzlich explizit (idempotent auf Client-Seite),
        // damit auch Peers ohne Consumer den Stream aus dem Roster nehmen.
        this.notifyOthers(room, peer.id, {
          op: 'producerClosed',
          producerId: msg.producerId,
          peerId: peer.id,
        });
        return { closed: true };
      }

      case 'getProducers': {
        const producers: VoiceProducerInfo[] = room
          .otherProducers(peer.id)
          .map(({ producer, peer: owner }) => producerInfo(producer, owner));
        return { producers };
      }

      default:
        // Erschöpfende Prüfung – neue Opcodes fallen beim Kompilieren auf.
        return assertNever(msg);
    }
  }

  // --- Trennung -------------------------------------------------------------

  private onPeerGone(peer: Peer): void {
    const room = this.mediasoup.getRoom(peer.channelId);
    // Producer-IDs vor dem Schließen einsammeln, um sie den anderen zu melden.
    const producerIds = [...peer.producers.keys()];
    peer.close();

    if (room) {
      room.peers.delete(peer.id);
      for (const producerId of producerIds) {
        this.notifyOthers(room, peer.id, { op: 'producerClosed', producerId, peerId: peer.id });
      }
      this.notifyOthers(room, peer.id, { op: 'peerLeft', peerId: peer.id, userId: peer.userId });
      this.mediasoup.closeRoomIfEmpty(room);
    }

    // Der API-Roster wird nur benachrichtigt, wenn dies eine echte Trennung ist –
    // nicht bei Ersetzung durch eine neue Verbindung desselben Nutzers.
    if (!peer.replaced) this.publishDisconnect(peer.userId, peer.channelId);
  }

  private notifyOthers(room: Room, exceptPeerId: string, message: VoiceServerMessage): void {
    for (const other of room.peers.values()) {
      if (other.id === exceptPeerId) continue;
      send(other.socket, message);
    }
  }

  /**
   * Voice-Moderation (Phase 13): schließt die Medien-WS eines Nutzers in einem
   * Kanal (auf Anweisung der API per Redis). Der reguläre close-Handler
   * (onPeerGone) räumt den Peer auf und meldet die Trennung zurück.
   */
  forceDisconnect(userId: string, channelId: string): void {
    const room = this.mediasoup.getRoom(channelId);
    if (!room) return;
    for (const peer of room.peers.values()) {
      if (peer.userId === userId) peer.socket.close(4006, 'Von der Moderation getrennt');
    }
  }

  close(): void {
    this.wss?.close();
  }
}

function producerInfo(producer: types.Producer, owner: Peer): VoiceProducerInfo {
  // source wurde beim produce als appData gesetzt; Fallback 'mic' für Audio.
  const source = (producer.appData as { source?: VoiceSource }).source ?? 'mic';
  return {
    producerId: producer.id,
    peerId: owner.id,
    userId: owner.userId,
    username: owner.username,
    kind: producer.kind as 'audio' | 'video',
    source,
  };
}

function send(socket: WebSocket, message: VoiceServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function assertNever(x: never): never {
  throw new Error(`Unbekannter Opcode: ${JSON.stringify(x)}`);
}
