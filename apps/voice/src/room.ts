import { randomUUID } from 'node:crypto';
import type { types } from 'mediasoup';
import type { WebSocket } from 'ws';

/**
 * Ein Teilnehmer einer Sprach-Session (eine Medien-WebSocket zum SFU).
 * `peerId` ist SFU-intern; `userId` ist der Parley-Account. Ein Peer hält je
 * einen Send- (eigenes Mikro) und Recv-Transport (andere hören) sowie seine
 * Producer/Consumer.
 */
export class Peer {
  readonly id = randomUUID();
  sendTransportId: string | null = null;
  recvTransportId: string | null = null;
  /**
   * true, wenn dieser Peer durch eine neue Verbindung DESSELBEN Nutzers ersetzt
   * wurde (zweiter Tab / Reconnect). Dann darf sein Cleanup KEIN Trenn-Signal an
   * die API senden – der Nutzer ist über die neue Verbindung weiterhin im Kanal.
   */
  replaced = false;
  readonly transports = new Map<string, types.WebRtcTransport>();
  readonly producers = new Map<string, types.Producer>();
  readonly consumers = new Map<string, types.Consumer>();

  constructor(
    readonly socket: WebSocket,
    readonly userId: string,
    readonly username: string,
    readonly channelId: string,
  ) {}

  /** Schließt alle Transporte – das schließt kaskadierend Producer und Consumer. */
  close(): void {
    for (const transport of this.transports.values()) transport.close();
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }
}

/**
 * Ein Sprachkanal im SFU: genau ein mediasoup-Router (alle Teilnehmer eines
 * Kanals teilen ihn) plus die verbundenen Peers. Der Router wird angelegt,
 * sobald der erste Peer beitritt, und geschlossen, wenn der letzte geht.
 */
export class Room {
  readonly peers = new Map<string, Peer>();

  constructor(
    readonly channelId: string,
    readonly router: types.Router,
  ) {}

  get isEmpty(): boolean {
    return this.peers.size === 0;
  }

  /** Alle Producer der ANDEREN Teilnehmer (zum Konsumieren beim Beitritt/neu). */
  otherProducers(exceptPeerId: string): { producer: types.Producer; peer: Peer }[] {
    const result: { producer: types.Producer; peer: Peer }[] = [];
    for (const peer of this.peers.values()) {
      if (peer.id === exceptPeerId) continue;
      for (const producer of peer.producers.values()) result.push({ producer, peer });
    }
    return result;
  }

  /** Findet den Peer, dem ein Producer gehört. */
  findProducer(producerId: string): { producer: types.Producer; peer: Peer } | null {
    for (const peer of this.peers.values()) {
      const producer = peer.producers.get(producerId);
      if (producer) return { producer, peer };
    }
    return null;
  }
}
