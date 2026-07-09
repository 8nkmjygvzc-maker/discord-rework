/**
 * Typen für Moderationswerkzeuge (Phase 13): Kick/Bann/Timeout, Audit-Log,
 * Voice-Trennen. Alle Aktionen werden serverseitig durchgesetzt (Rechte aus
 * Phase 5) und – bis auf reine Lesezugriffe – im Audit-Log protokolliert.
 */

/** Protokollierte Moderationsaktionen (Audit-Log). */
export type AuditAction =
  | 'MEMBER_KICK'
  | 'MEMBER_BAN'
  | 'MEMBER_UNBAN'
  | 'MEMBER_TIMEOUT'
  | 'MEMBER_TIMEOUT_REMOVE'
  | 'MESSAGE_DELETE'
  | 'VOICE_DISCONNECT';

/**
 * Ein Audit-Log-Eintrag, wie ihn die API ausliefert. Zielangaben sind
 * denormalisiert (targetUsername), damit der Eintrag lesbar bleibt, auch wenn
 * das Zielmitglied den Server später verlässt.
 */
export interface AuditLogEntryInfo {
  id: string;
  action: AuditAction;
  actorId: string;
  actorUsername: string;
  /** Betroffenes Mitglied (null bei nicht personenbezogenen Aktionen). */
  targetUserId: string | null;
  targetUsername: string | null;
  reason: string | null;
  createdAt: string;
}

/** Ein aktiver Bann eines Servers. */
export interface BanInfo {
  userId: string;
  username: string;
  bannedById: string;
  bannedByUsername: string;
  reason: string | null;
  createdAt: string;
}

/** Obergrenze für frei eingegebene Begründungen (Kick/Bann/Timeout). */
export const MODERATION_REASON_MAX_LENGTH = 500;

/** Timeout-Dauer: mindestens 1 Sekunde, höchstens 28 Tage (wie Discord). */
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

export interface KickRequest {
  reason?: string;
}

export interface BanRequest {
  reason?: string;
}

export interface TimeoutRequest {
  /** Dauer der Auszeit ab jetzt, in Sekunden. */
  durationSeconds: number;
  reason?: string;
}
