import { createServer } from 'node:http';
import Redis from 'ioredis';
import { config } from './config';
import { MediasoupManager } from './mediasoup-manager';
import { SignalingServer } from './signaling';

/** Redis-Kanal, über den der API-Roster von Trennungen erfährt (siehe VoiceService). */
const VOICE_DISCONNECT_CHANNEL = 'voice:disconnect';

async function bootstrap(): Promise<void> {
  const mediasoup = new MediasoupManager();
  await mediasoup.init();

  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });

  const signaling = new SignalingServer(mediasoup, (userId, channelId) => {
    void redis.publish(VOICE_DISCONNECT_CHANNEL, JSON.stringify({ userId, channelId }));
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
    signaling.close();
    void mediasoup.close();
    void redis.quit();
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
