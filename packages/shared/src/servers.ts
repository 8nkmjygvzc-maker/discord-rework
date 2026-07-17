/** Typen für Server, Kanäle und Mitgliedschaften (Phase 3). */
import type { RoleInfo } from './permissions';
import type { VoiceState } from './voice';

export type ChannelType = 'TEXT' | 'VOICE' | 'VIDEO' | 'DM';

export interface ServerSummary {
  id: string;
  name: string;
  ownerId: string;
  iconUrl: string | null;
  createdAt: string;
}

export interface ServerMember {
  userId: string;
  username: string;
  nickname: string | null;
  /** Profilbild (Phase 15) – null = Initialen-Platzhalter. */
  avatarUrl: string | null;
  /** Profil-Banner für die Profilkarte – null = Farbverlauf. */
  bannerUrl: string | null;
  /** Status-Text des Nutzers („Was machst du gerade?“, Phase 15). */
  status: string;
  joinedAt: string;
  /** Zugewiesene Rollen (ohne die implizite Standardrolle). */
  roleIds: string[];
  /**
   * Ende einer aktiven Auszeit (Timeout, Phase 13) als ISO-String, sonst null.
   * Liegt der Zeitpunkt in der Vergangenheit, ist die Auszeit abgelaufen.
   */
  timeoutUntil: string | null;
}

export interface ChannelInfo {
  id: string;
  /** null bei DM-Kanälen (ab Phase 7). */
  serverId: string | null;
  type: ChannelType;
  name: string;
  position: number;
  isPrivate: boolean;
}

/** Vollansicht eines Servers für Mitglieder. */
export interface ServerDetails extends ServerSummary {
  channels: ChannelInfo[];
  members: ServerMember[];
  roles: RoleInfo[];
  /** Effektive Rechte des anfragenden Nutzers (Bitfield als String). */
  myPermissions: string;
  /** Aktuelle Sprachkanal-Belegung (Phase 10), gruppiert per channelId im Client. */
  voiceStates: VoiceState[];
}

export interface CreateServerRequest {
  name: string;
}

export interface UpdateServerRequest {
  name?: string;
  iconUrl?: string;
}

export interface CreateChannelRequest {
  name: string;
  /** Voreinstellung TEXT; VOICE ab Phase 10. VIDEO folgt in Phase 11. */
  type?: Extract<ChannelType, 'TEXT' | 'VOICE'>;
}

export interface UpdateChannelRequest {
  name?: string;
  position?: number;
}

/**
 * Kanal-Reihenfolge neu setzen (Verbesserungs-Runde). Die Liste muss GENAU
 * alle Kanäle des Servers enthalten – die Position wird zum Listen-Index,
 * damit die Reihenfolge lückenlos und für alle Clients identisch ist.
 */
export interface ReorderChannelsRequest {
  channelIds: string[];
}

/** Payload des CHANNELS_REORDER-Events: alle Kanäle mit neuen Positionen. */
export interface ChannelsReorderPayload {
  serverId: string;
  channels: ChannelInfo[];
}
