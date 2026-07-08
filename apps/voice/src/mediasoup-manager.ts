import * as mediasoup from 'mediasoup';
import type { types } from 'mediasoup';
import { config } from './config';
import { Room } from './room';

/**
 * Audio-Codecs des Routers. Für Phase 10 nur Opus; Video/VP8 kommt in Phase 11
 * (dann hier ergänzen – der Rest des SFU bleibt unverändert).
 */
const MEDIA_CODECS: types.RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
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
