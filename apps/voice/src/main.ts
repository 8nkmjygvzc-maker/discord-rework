import { createServer } from 'node:http';
import Redis from 'ioredis';
import { config } from './config';
import { MediasoupManager } from './mediasoup-manager';
import { SignalingServer } from './signaling';

/** Redis-Kanal, über den der API-Roster von Trennungen erfährt (siehe VoiceService). */
const VOICE_DISCONNECT_CHANNEL = 'voice:disconnect';
/** Redis-Kanal, über den die API Voice-Trennungen anweist (Moderation, Phase 13). */
const VOICE_FORCE_DISCONNECT_CHANNEL = 'voice:force-disconnect';
/**
 * Liveness-Keys (Phase 14): pro verbundenem Peer `voice:peer:{userId}` = channelId
 * mit TTL. Der API-Roster nutzt sie, um verwaiste VoiceSessions zu erkennen
 * (Multi-Instanz-fest, statt beim Start alle Sessions zu löschen).
 */
const VOICE_PEER_KEY_PREFIX = 'voice:peer:';
/** TTL der Liveness-Keys; muss deutlich über dem Refresh-Intervall liegen. */
const VOICE_PEER_TTL_S = 30;
const VOICE_HEARTBEAT_MS = 10_000;

async function bootstrap(): Promise<void> {
  const mediasoup = new MediasoupManager();
  await mediasoup.init();

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

  const markPeerAlive = (userId: string, channelId: string): void => {
    void redis.set(VOICE_PEER_KEY_PREFIX + userId, channelId, 'EX', VOICE_PEER_TTL_S);
  };

  const signaling = new SignalingServer(
    mediasoup,
    (userId, channelId) => {
      void redis.publish(VOICE_DISCONNECT_CHANNEL, JSON.stringify({ userId, channelId }));
    },
    markPeerAlive,
  );

  // Heartbeat: die Liveness-Keys aller verbundenen Peers regelmäßig erneuern,
  // damit sie nicht ablaufen und der API-Roster sie als lebend erkennt (Phase 14).
  const heartbeat = setInterval(() => {
    for (const peer of mediasoup.livePeers()) markPeerAlive(peer.userId, peer.channelId);
  }, VOICE_HEARTBEAT_MS);
  heartbeat.unref();

  // Eigene Verbindung zum Abonnieren (eine Redis-Verbindung im Subscribe-Modus
  // kann nicht publishen). Auf Moderations-Trennungen der API reagieren.
  const subscriber = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  void subscriber.subscribe(VOICE_FORCE_DISCONNECT_CHANNEL);
  subscriber.on('message', (_channel, message) => {
    try {
      const { userId, channelId } = JSON.parse(message) as { userId?: string; channelId?: string };
      if (userId && channelId) signaling.forceDisconnect(userId, channelId);
    } catch {
      console.warn('Ungültiges voice:force-disconnect-Signal verworfen');
    }
  });

  // Eigener HTTP-Server: /health für Probes, /voice ist die Signaling-WS.
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'voice' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  signaling.attach(server);

  server.listen(config.port, () => {
    console.log(`Parley Voice-SFU lauscht auf http://localhost:${config.port} (WS /voice)`);
  });

  const shutdown = (): void => {
    clearInterval(heartbeat);
    signaling.close();
    void mediasoup.close();
    void redis.quit();
    void subscriber.quit();
    server.close(() => process.exit(0));
    // Notausgang, falls Verbindungen hängen.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void bootstrap().catch((err: unknown) => {
  console.error('Voice-SFU-Start fehlgeschlagen:', err);
  process.exit(1);
});
