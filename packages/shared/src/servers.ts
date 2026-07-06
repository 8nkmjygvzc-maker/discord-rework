/** Typen für Server, Kanäle und Mitgliedschaften (Phase 3). */
import type { RoleInfo } from './permissions';

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
  joinedAt: string;
  /** Zugewiesene Rollen (ohne die implizite Standardrolle). */
  roleIds: string[];
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
}

export interface UpdateChannelRequest {
  name?: string;
  position?: number;
}
