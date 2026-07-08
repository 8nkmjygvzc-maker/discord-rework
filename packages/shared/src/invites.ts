/**
 * Einladungslinks (Phase 12). Ein Invite verweist per kurzem Code auf einen
 * Server; optional mit Ablaufdatum und/oder Nutzungslimit. Ersetzt den offenen
 * „Beitritt per Server-ID“-Endpunkt aus Phase 3 als bevorzugten Weg.
 */

/** Ein Einladungslink, wie ihn die API an Berechtigte ausliefert. */
export interface InviteInfo {
  code: string;
  serverId: string;
  /** Ersteller (Username) – für die Verwaltungsliste. */
  createdBy: string;
  /** null = unbegrenzt oft nutzbar. */
  maxUses: number | null;
  /** Wie oft schon eingelöst. */
  uses: number;
  /** ISO-Zeitstempel oder null = kein Ablauf. */
  expiresAt: string | null;
  createdAt: string;
}

/** Body von POST /api/servers/:id/invites. Beide Felder optional. */
export interface CreateInviteRequest {
  /** Maximale Einlösungen; weglassen/null = unbegrenzt. */
  maxUses?: number | null;
  /** Gültigkeitsdauer in Sekunden ab jetzt; weglassen/null = kein Ablauf. */
  expiresInSeconds?: number | null;
}

/**
 * Vorschau eines Codes (GET /api/invites/:code) – zeigt dem Einladenden, was ihn
 * erwartet, BEVOR er beitritt. Nur für angemeldete Nutzer; verrät nur Name und
 * Mitgliederzahl, keine Kanäle/Nachrichten.
 */
export interface InvitePreview {
  code: string;
  serverId: string;
  serverName: string;
  memberCount: number;
  /** Username des Einladenden. */
  inviterUsername: string;
  expiresAt: string | null;
  /** true, wenn der abrufende Nutzer bereits Mitglied ist (Beitritt no-op). */
  alreadyMember: boolean;
}
