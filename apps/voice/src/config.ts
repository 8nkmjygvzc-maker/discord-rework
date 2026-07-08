import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

// .env liegt im Repo-Root (geteilt mit API/Web); Fallback auf lokale .env.
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return value;
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret === 'CHANGE_ME_GENERATE_RANDOM_64_HEX') {
  throw new Error('JWT_SECRET ist der Beispielwert – bitte .env prüfen');
}

export const config = {
  /** Port der Signaling-WebSocket des SFU. */
  port: Number(process.env.VOICE_PORT ?? 3002),
  /** Gemeinsames JWT-Secret der API – zur Verifikation des Voice-Tokens. */
  jwtSecret,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  mediasoup: {
    /** IP, an der mediasoup lauscht (0.0.0.0 für alle Interfaces). */
    listenIp: process.env.MEDIASOUP_LISTEN_IP ?? '127.0.0.1',
    /**
     * Öffentlich erreichbare IP für die ICE-Kandidaten. Im Dev auf einer
     * Maschine reicht 127.0.0.1 (leer lassen). Für LAN/Server: die von außen
     * erreichbare IP setzen, sonst finden Clients den SFU nicht.
     */
    announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || undefined,
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT ?? 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT ?? 40100),
  },
} as const;
