/** Typen für Freundesystem & Direktnachrichten (Phase 7). */

/** Öffentliche Minimal-Daten eines Nutzers in Freundes-/DM-Kontexten. */
export interface PublicUser {
  id: string;
  username: string;
  avatarUrl: string | null;
  /** Profil-Banner (Querformat) für die Profilkarte, null = Farbverlauf. */
  bannerUrl: string | null;
  status: string;
}

export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'BLOCKED';

export interface FriendRequestInfo {
  user: PublicUser;
  createdAt: string;
}

/** Antwort von GET /api/friends – alles aus Sicht des anfragenden Nutzers.
 *  Wer MICH blockiert hat, taucht nirgends auf (kein Leak). */
export interface FriendsList {
  friends: PublicUser[];
  /** Offene Anfragen AN mich (annehmen/ablehnen). */
  incoming: FriendRequestInfo[];
  /** Meine offenen Anfragen (zurückziehbar). */
  outgoing: FriendRequestInfo[];
  /** Von mir blockierte Nutzer. */
  blocked: PublicUser[];
}

/** Body von POST /api/friends – Anfrage per Benutzername. */
export interface AddFriendRequest {
  username: string;
}

/** DM-Kanal aus Sicht EINES Teilnehmers (`otherUser` = die Gegenseite). */
export interface DmChannelInfo {
  id: string;
  otherUser: PublicUser;
  createdAt: string;
  /** Zeitstempel der letzten Nachricht (null = noch keine) – sortiert die DM-Liste. */
  lastMessageAt: string | null;
}

/** Body von POST /api/dms – öffnet (oder findet) den DM-Kanal zu einem Nutzer. */
export interface OpenDmRequest {
  userId: string;
}
