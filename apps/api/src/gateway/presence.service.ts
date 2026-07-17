import { Injectable } from '@nestjs/common';
import type { PresenceUser } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Sichtbarer Anwesenheits-Modus eines Nutzers laut DB: 'online' | 'dnd',
   * oder null bei INVISIBLE – dann darf er für andere nie als online
   * erscheinen (weder in Snapshots noch in PRESENCE_UPDATE-Broadcasts).
   */
  async visibleModeOf(userId: string): Promise<'online' | 'dnd' | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { presence: true },
    });
    if (!user || user.presence === 'INVISIBLE') return null;
    return user.presence === 'DND' ? 'dnd' : 'online';
  }

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
   * Skalierungs-freundliche Momentaufnahme (Phase 14): prüft NUR die übergebenen
   * Kandidaten-IDs gegen den lebenden Verbindungszähler – O(Kandidaten) statt
   * O(alle Online-Nutzer). Genutzt für den READY-Snapshot und Presence-Nachschub,
   * die ohnehin auf den Sichtbarkeitskreis (Freunde/Server/DMs) beschränkt sind.
   *
   * Räumt dabei Leichen im Presence-Hash im geprüften Kreis lazy auf (Eintrag
   * ohne lebenden Zähler – entsteht, wenn eine Instanz abstürzt und nur die TTL
   * den Zähler entfernt hat). Das war früher Aufgabe von `getOnlineUsers()`, das
   * mit Phase 14 wegfällt, weil kein Codepfad mehr ALLE Online-Nutzer lädt.
   */
  async filterOnline(candidateIds: string[]): Promise<PresenceUser[]> {
    const unique = [...new Set(candidateIds)];
    if (unique.length === 0) return [];

    // Lebenden Verbindungszähler jedes Kandidaten prüfen (eine Pipeline).
    const pipeline = this.redis.client.pipeline();
    for (const id of unique) pipeline.exists(CONN_KEY_PREFIX + id);
    const existsResults = (await pipeline.exec()) ?? [];

    // Benutzernamen aller Kandidaten in einem Rutsch (HMGET). Über alle – nicht
    // nur die Online-Treffer – abfragen, damit Hash-Leichen im Kreis auffallen.
    const usernames = (await this.redis.client.hmget(USERS_HASH_KEY, ...unique)) as (
      string | null
    )[];

    const online: PresenceUser[] = [];
    const stale: string[] = [];
    unique.forEach((id, i) => {
      const isOnline = existsResults[i]?.[1] === 1;
      const username = usernames[i];
      if (isOnline) {
        if (username) online.push({ id, username });
      } else if (username !== null) {
        // Hash-Eintrag ohne lebenden Zähler → Leiche, aufräumen.
        stale.push(id);
      }
    });
    if (stale.length > 0) await this.redis.client.hdel(USERS_HASH_KEY, ...stale);
    if (online.length === 0) return online;

    // Gewählten Anwesenheits-Modus aus der DB anreichern: INVISIBLE fliegt
    // aus JEDER Online-Antwort (für andere ununterscheidbar von offline),
    // DND reist als Anzeige-Marker mit. Die DB statt Redis ist hier bewusst
    // die Quelle – der Modus kann sich jederzeit per REST ändern und würde
    // in einem Redis-Cache veralten.
    const modes = await this.prisma.user.findMany({
      where: { id: { in: online.map((u) => u.id) } },
      select: { id: true, presence: true },
    });
    const modeById = new Map(modes.map((m) => [m.id, m.presence]));
    return online.flatMap((u) => {
      const mode = modeById.get(u.id) ?? 'ONLINE';
      if (mode === 'INVISIBLE') return [];
      return [{ ...u, presence: mode === 'DND' ? ('dnd' as const) : ('online' as const) }];
    });
  }
}
