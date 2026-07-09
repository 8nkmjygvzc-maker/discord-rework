import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import { config } from './config';
import { Room } from './room';

/**
 * Codecs des Routers. Audio = Opus (Phase 10). Video (Phase 11): VP8 und H264,
 * damit sowohl Chrome/Firefox (VP8) als auch Safari (H264) Kamera und
 * Bildschirmfreigabe senden können. `x-google-start-bitrate` gibt dem Encoder
 * einen sinnvollen Startpunkt; der Rest wird pro Producer per encodings geregelt.
 */
const MEDIA_CODECS: types.RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
  },
  {
    kind: 'video',
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

/**
 * Verwaltet den mediasoup-Worker und die Räume (ein Router pro Sprachkanal).
 * v1: EIN Worker. Für mehr Last mehrere Worker + Router-Piping (siehe ROADMAP).
 */
export class MediasoupManager {
  private worker!: types.Worker;
  private readonly rooms = new Map<string, Room>();

  async init(): Promise<void> {
    this.worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: config.mediasoup.rtcMinPort,
      rtcMaxPort: config.mediasoup.rtcMaxPort,
    });
    // Stirbt der Worker (C++-Prozess), ist der SFU nicht mehr funktionsfähig →
    // hart beenden, der Prozessmanager startet neu.
    this.worker.on('died', () => {
      console.error('mediasoup-Worker gestorben – SFU wird beendet');
      process.exit(1);
    });
  }

  getRoom(channelId: string): Room | undefined {
    return this.rooms.get(channelId);
  }

  /**
   * Alle aktuell verbundenen Peers über alle Räume (Phase 14). Grundlage für die
   * Liveness-Heartbeats in Redis, mit denen der API-Roster verwaiste
   * VoiceSessions erkennt – ohne den destruktiven „beim Start alles löschen“-Weg.
   */
  livePeers(): { userId: string; channelId: string }[] {
    const peers: { userId: string; channelId: string }[] = [];
    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        peers.push({ userId: peer.userId, channelId: peer.channelId });
      }
    }
    return peers;
  }

  /** Liefert den Raum eines Kanals; legt ihn (inkl. Router) bei Bedarf an. */
  async getOrCreateRoom(channelId: string): Promise<Room> {
    const existing = this.rooms.get(channelId);
    if (existing) return existing;
    const router = await this.worker.createRouter({ mediaCodecs: MEDIA_CODECS });
    const room = new Room(channelId, router);
    this.rooms.set(channelId, room);
    return room;
  }

  /** Schließt den Router und entfernt den Raum, sobald er leer ist. */
  closeRoomIfEmpty(room: Room): void {
    if (!room.isEmpty) return;
    room.router.close();
    this.rooms.delete(room.channelId);
  }

  /** Erzeugt einen WebRTC-Transport im Router eines Raums. */
  createWebRtcTransport(router: types.Router): Promise<types.WebRtcTransport> {
    return router.createWebRtcTransport({
      listenIps: [{ ip: config.mediasoup.listenIp, announcedIp: config.mediasoup.announcedIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 800_000,
    });
  }

  async close(): Promise<void> {
    for (const room of this.rooms.values()) room.router.close();
    this.rooms.clear();
    this.worker?.close();
    await Promise.resolve();
  }
}
