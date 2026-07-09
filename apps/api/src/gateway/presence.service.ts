import { Injectable } from '@nestjs/common';
import type { PresenceUser } from '@parley/shared';
import { RedisService } from '../redis/redis.service';

/**
 * Online-Status in Redis, damit er über mehrere Gateway-Instanzen hinweg
 * konsistent ist:
 *
 *   presence:conn:{userId}  Zähler offener Verbindungen (mehrere Tabs!),
 *                           mit TTL als Totmann-Schalter: stürzt eine
 *                           Instanz ab, räumt Redis den Eintrag selbst weg.
 *   presence:users          Hash userId → username für die Online-Momentaufnahme.
 */
const CONN_KEY_PREFIX = 'presence:conn:';
const USERS_HASH_KEY = 'presence:users';

/** TTL des Verbindungszählers; wird mit jedem Heartbeat (15 s) verlängert. */
const PRESENCE_TTL_S = 60;

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  /** Registriert eine Verbindung. Liefert true, wenn der Nutzer dadurch online GEHT (0 → 1). */
  async markOnline(user: PresenceUser): Promise<boolean> {
    const key = CONN_KEY_PREFIX + user.id;
    const [[, count]] = (await this.redis.client
      .multi()
      .incr(key)
      .expire(key, PRESENCE_TTL_S)
      .hset(USERS_HASH_KEY, user.id, user.username)
      .exec()) as [[unknown, number], ...unknown[][]];
    return count === 1;
  }

  /** Verlängert die Presence-TTL; Heartbeat-getrieben. */
  async refresh(user: PresenceUser): Promise<void> {
    const refreshed = await this.redis.client.expire(CONN_KEY_PREFIX + user.id, PRESENCE_TTL_S);
    // Zähler zwischenzeitlich per TTL weggeräumt (z. B. Rechner im Standby):
    // Verbindung lebt aber noch → Nutzer wieder als online registrieren.
    if (refreshed === 0) await this.markOnline(user);
  }

  /** true, wenn der Nutzer aktuell mindestens eine lebende Gateway-Verbindung hat. */
  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.client.exists(CONN_KEY_PREFIX + userId)) === 1;
  }

  /** Meldet eine Verbindung ab. Liefert true, wenn der Nutzer dadurch offline GEHT (letzte Verbindung). */
  async markOffline(user: PresenceUser): Promise<boolean> {
    const key = CONN_KEY_PREFIX + user.id;
    const count = await this.redis.client.decr(key);
    if (count > 0) return false;
    await this.redis.client.multi().del(key).hdel(USERS_HASH_KEY, user.id).exec();
    return true;
  }

  /**
   * Skalierungs-freundliche Variante (Phase 14): prüft NUR die übergebenen
   * Kandidaten-IDs gegen den lebenden Verbindungszähler – O(Kandidaten) statt
   * O(alle Online-Nutzer). Genutzt für den READY-Snapshot und Presence-Nachschub,
   * die ohnehin auf den Sichtbarkeitskreis (Freunde/Server/DMs) beschränkt sind.
   */
  async filterOnline(candidateIds: string[]): Promise<PresenceUser[]> {
    const unique = [...new Set(candidateIds)];
    if (unique.length === 0) return [];

    const pipeline = this.redis.client.pipeline();
    for (const id of unique) pipeline.exists(CONN_KEY_PREFIX + id);
    const results = (await pipeline.exec()) ?? [];
    const onlineIds = unique.filter((_, i) => results[i]?.[1] === 1);
    if (onlineIds.length === 0) return [];

    // Benutzernamen der Online-Kandidaten in einem Rutsch (HMGET).
    const usernames = (await this.redis.client.hmget(USERS_HASH_KEY, ...onlineIds)) as (
      | string
      | null
    )[];
    const online: PresenceUser[] = [];
    onlineIds.forEach((id, i) => {
      const username = usernames[i];
      if (username) online.push({ id, username });
    });
    return online;
  }

  /**
   * Momentaufnahme ALLER Online-Nutzer. Prüft jeden Hash-Eintrag gegen den
   * lebenden Verbindungszähler und räumt Leichen auf (entstehen, wenn eine
   * Instanz abstürzt und nur die TTL den Zähler entfernt hat). Skaliert linear
   * mit der Gesamtzahl Online-Nutzer – für gezielte Abfragen `filterOnline`.
   */
  async getOnlineUsers(): Promise<PresenceUser[]> {
    const entries = await this.redis.client.hgetall(USERS_HASH_KEY);
    const ids = Object.keys(entries);
    if (ids.length === 0) return [];

    const pipeline = this.redis.client.pipeline();
    for (const id of ids) pipeline.exists(CONN_KEY_PREFIX + id);
    const results = (await pipeline.exec()) ?? [];

    const online: PresenceUser[] = [];
    const stale: string[] = [];
    ids.forEach((id, i) => {
      if (results[i]?.[1] === 1) online.push({ id, username: entries[id] });
      else stale.push(id);
    });
    if (stale.length > 0) await this.redis.client.hdel(USERS_HASH_KEY, ...stale);
    return online;
  }
}
