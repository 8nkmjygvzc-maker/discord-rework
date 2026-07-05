import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Zentraler Redis-Zugang. `client` ist für normale Kommandos (GET/SET/PUBLISH …).
 * Für SUBSCRIBE braucht ioredis eine eigene Verbindung (eine abonnierte
 * Verbindung darf keine anderen Kommandos mehr senden) → `createSubscriber()`.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private readonly subscribers: Redis[] = [];

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      // Fehler nicht endlos puffern, sondern sofort werfen – Verbindungsprobleme
      // sollen im Dev-Betrieb sichtbar sein statt still zu hängen.
      maxRetriesPerRequest: 3,
    });
  }

  /** Eigene Verbindung für Pub/Sub-Abonnements. Wird beim Shutdown mitgeschlossen. */
  createSubscriber(): Redis {
    const sub = this.client.duplicate();
    this.subscribers.push(sub);
    return sub;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), ...this.subscribers.map((s) => s.quit())]);
  }
}
