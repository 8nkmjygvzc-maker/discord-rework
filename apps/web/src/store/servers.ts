import { create } from 'zustand';
import {
  AuditLogEntryInfo,
  BanInfo,
  ChannelDeletePayload,
  ChannelInfo,
  GatewayEventType,
  permissionsFromString,
  RoleInfo,
  ServerDeletePayload,
  ServerDetails,
  ServerMember,
  ServerMemberRemovePayload,
  ServerSummary,
  UserUpdatePayload,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { useVoiceStore } from './voice';

interface ServersState {
  servers: ServerSummary[];
  /** Vollansicht des ausgewählten Servers (Kanäle + Mitglieder). */
  selectedServer: ServerDetails | null;
  selectedChannelId: string | null;
  loaded: boolean;

  loadServers: () => Promise<void>;
  selectServer: (serverId: string | null) => Promise<void>;
  selectChannel: (channelId: string) => void;
  createServer: (name: string) => Promise<void>;
  /** Einladungscode einlösen (Phase 12) und zum Server wechseln. */
  acceptInvite: (code: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  /** Servereinstellungen (Verbesserungs-Runde): Name ändern, Icon entfernen (''). */
  updateServer: (serverId: string, changes: { name?: string; iconUrl?: '' }) => Promise<void>;
  createChannel: (name: string, type?: 'TEXT' | 'VOICE') => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;

  createRole: (name: string) => Promise<void>;
  updateRole: (
    roleId: string,
    changes: { name?: string; permissions?: string; color?: string | null },
  ) => Promise<void>;
  deleteRole: (roleId: string) => Promise<void>;
  setMemberRole: (userId: string, roleId: string, assign: boolean) => Promise<void>;

  /** Moderation (Phase 13) – Durchsetzung + Broadcasts laufen serverseitig. */
  kickMember: (userId: string, reason?: string) => Promise<void>;
  banMember: (userId: string, reason?: string) => Promise<void>;
  unbanMember: (userId: string) => Promise<void>;
  timeoutMember: (userId: string, durationSeconds: number, reason?: string) => Promise<void>;
  removeMemberTimeout: (userId: string) => Promise<void>;
  voiceDisconnectMember: (userId: string) => Promise<void>;
  listBans: () => Promise<BanInfo[]>;
  loadAuditLog: () => Promise<AuditLogEntryInfo[]>;

  /** Effektive eigene Rechte im ausgewählten Server (0n ohne Auswahl). */
  myPermissions: () => bigint;

  /** Echtzeit-Updates aus dem Gateway (siehe lib/gatewayConnection.ts). */
  handleGatewayEvent: (t: GatewayEventType, d: unknown) => void;
  reset: () => void;
}

const byPosition = (a: ChannelInfo, b: ChannelInfo): number => a.position - b.position;

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

export const useServersStore = create<ServersState>()((set, get) => ({
  servers: [],
  selectedServer: null,
  selectedChannelId: null,
  loaded: false,

  loadServers: async () => {
    const servers = await authFetch<ServerSummary[]>('/api/servers');
    set({ servers, loaded: true });
    const { selectedServer } = get();
    // Auswahl validieren bzw. initial setzen; Details immer frisch nachladen
    // (nach Reconnect können Events verpasst worden sein).
    const targetId = servers.some((s) => s.id === selectedServer?.id)
      ? selectedServer!.id
      : (servers[0]?.id ?? null);
    await get().selectServer(targetId);
  },

  selectServer: async (serverId) => {
    if (!serverId) {
      set({ selectedServer: null, selectedChannelId: null });
      useVoiceStore.getState().setVoiceStates([]);
      return;
    }
    const details = await authFetch<ServerDetails>(`/api/servers/${serverId}`);
    set((s) => ({
      selectedServer: details,
      // Kanal-Auswahl behalten, wenn er noch existiert (Text ODER Voice –
      // Sprachkanäle haben eine eigene Großansicht), sonst erster Textkanal.
      selectedChannelId: details.channels.some((c) => c.id === s.selectedChannelId)
        ? s.selectedChannelId
        : (details.channels.find((c) => c.type === 'TEXT')?.id ?? null),
    }));
    // Voice-Roster des Servers in den Voice-Store spiegeln.
    useVoiceStore.getState().setVoiceStates(details.voiceStates);
  },

  selectChannel: (channelId) => set({ selectedChannelId: channelId }),

  createServer: async (name) => {
    const details = await authFetch<ServerDetails>('/api/servers', {
      method: 'POST',
      body: { name },
    });
    set((s) => ({
      servers: [...s.servers, toSummary(details)],
      selectedServer: details,
      selectedChannelId: details.channels.find((c) => c.type === 'TEXT')?.id ?? null,
    }));
    useVoiceStore.getState().setVoiceStates(details.voiceStates);
  },

  acceptInvite: async (code) => {
    const details = await authFetch<ServerDetails>(`/api/invites/${encodeURIComponent(code)}`, {
      method: 'POST',
    });
    set((s) => ({
      servers: [...s.servers.filter((x) => x.id !== details.id), toSummary(details)],
      selectedServer: details,
      selectedChannelId: details.channels.find((c) => c.type === 'TEXT')?.id ?? null,
    }));
    useVoiceStore.getState().setVoiceStates(details.voiceStates);
  },

  leaveServer: async (serverId) => {
    await authFetch<void>(`/api/servers/${serverId}/leave`, { method: 'POST' });
    get().handleGatewayEvent('SERVER_DELETE', { serverId } satisfies ServerDeletePayload);
  },

  deleteServer: async (serverId) => {
    await authFetch<void>(`/api/servers/${serverId}`, { method: 'DELETE' });
    get().handleGatewayEvent('SERVER_DELETE', { serverId } satisfies ServerDeletePayload);
  },

  updateServer: async (serverId, changes) => {
    const server = await authFetch<ServerSummary>(`/api/servers/${serverId}`, {
      method: 'PATCH',
      body: changes,
    });
    // Kommt zusätzlich als SERVER_UPDATE-Event – hier direkt einspielen,
    // damit der Bearbeitende nicht auf das Gateway warten muss.
    get().handleGatewayEvent('SERVER_UPDATE', { server });
  },

  createChannel: async (name, type = 'TEXT') => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    // Der Kanal kommt zusätzlich als CHANNEL_CREATE-Event zurück; das Update
    // hier sorgt nur dafür, dass der Ersteller nicht auf das Event warten muss.
    const channel = await authFetch<ChannelInfo>(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      body: { name, type },
    });
    get().handleGatewayEvent('CHANNEL_CREATE', { channel });
  },

  deleteChannel: async (channelId) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/channels/${channelId}`, { method: 'DELETE' });
    get().handleGatewayEvent('CHANNEL_DELETE', {
      serverId,
      channelId,
    } satisfies ChannelDeletePayload);
  },

  createRole: async (name) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    const role = await authFetch<RoleInfo>(`/api/servers/${serverId}/roles`, {
      method: 'POST',
      body: { name },
    });
    get().handleGatewayEvent('ROLE_CREATE', { role });
  },

  updateRole: async (roleId, changes) => {
    await authFetch<RoleInfo>(`/api/roles/${roleId}`, { method: 'PATCH', body: changes });
    // ROLE_UPDATE-Event lädt die Details neu (eigene Rechte können sich ändern).
  },

  deleteRole: async (roleId) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/roles/${roleId}`, { method: 'DELETE' });
    get().handleGatewayEvent('ROLE_DELETE', { serverId, roleId });
  },

  setMemberRole: async (userId, roleId, assign) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/members/${userId}/roles/${roleId}`, {
      method: assign ? 'PUT' : 'DELETE',
    });
  },

  // --- Moderation (Phase 13) – die Server-Events aktualisieren den Store ------

  kickMember: async (userId, reason) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/members/${userId}/kick`, {
      method: 'POST',
      body: { reason },
    });
  },

  banMember: async (userId, reason) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/bans/${userId}`, {
      method: 'PUT',
      body: { reason },
    });
  },

  unbanMember: async (userId) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/bans/${userId}`, { method: 'DELETE' });
  },

  timeoutMember: async (userId, durationSeconds, reason) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/members/${userId}/timeout`, {
      method: 'PUT',
      body: { durationSeconds, reason },
    });
  },

  removeMemberTimeout: async (userId) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/members/${userId}/timeout`, {
      method: 'DELETE',
    });
  },

  voiceDisconnectMember: async (userId) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    await authFetch<void>(`/api/servers/${serverId}/members/${userId}/voice-disconnect`, {
      method: 'POST',
    });
  },

  listBans: () => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return Promise.resolve([]);
    return authFetch<BanInfo[]>(`/api/servers/${serverId}/bans`);
  },

  loadAuditLog: () => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return Promise.resolve([]);
    return authFetch<AuditLogEntryInfo[]>(`/api/servers/${serverId}/audit-log`);
  },

  myPermissions: () => {
    const details = get().selectedServer;
    return details ? permissionsFromString(details.myPermissions) : 0n;
  },

  handleGatewayEvent: (t, d) => {
    switch (t) {
      case 'SERVER_UPDATE': {
        const { server } = d as { server: ServerSummary };
        set((s) => ({
          servers: s.servers.map((x) => (x.id === server.id ? server : x)),
          selectedServer:
            s.selectedServer?.id === server.id
              ? { ...s.selectedServer, ...server }
              : s.selectedServer,
        }));
        return;
      }
      case 'SERVER_DELETE': {
        const { serverId } = d as ServerDeletePayload;
        set((s) => {
          const servers = s.servers.filter((x) => x.id !== serverId);
          return { servers };
        });
        if (get().selectedServer?.id === serverId) {
          void get().selectServer(get().servers[0]?.id ?? null);
        }
        return;
      }
      case 'SERVER_MEMBER_ADD': {
        const { serverId, member } = d as { serverId: string; member: ServerMember };
        set((s) =>
          s.selectedServer?.id === serverId
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  members: [
                    ...s.selectedServer.members.filter((m) => m.userId !== member.userId),
                    member,
                  ],
                },
              }
            : {},
        );
        return;
      }
      case 'SERVER_MEMBER_REMOVE': {
        const { serverId, userId } = d as ServerMemberRemovePayload;
        // Der eigene Abgang (anderer Tab / später: Kick) wirkt wie SERVER_DELETE.
        if (userId === useAuthStore.getState().user?.id) {
          get().handleGatewayEvent('SERVER_DELETE', { serverId } satisfies ServerDeletePayload);
          return;
        }
        set((s) =>
          s.selectedServer?.id === serverId
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  members: s.selectedServer.members.filter((m) => m.userId !== userId),
                },
              }
            : {},
        );
        return;
      }
      case 'USER_UPDATE': {
        // Phase 15: Profiländerung (Status/Avatar) in der Mitgliederliste des
        // ausgewählten Servers nachziehen (Freunde/DMs machen ihre Stores selbst).
        const { user } = d as UserUpdatePayload;
        set((s) =>
          s.selectedServer
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  members: s.selectedServer.members.map((m) =>
                    m.userId === user.id
                      ? {
                          ...m,
                          avatarUrl: user.avatarUrl,
                          bannerUrl: user.bannerUrl,
                          status: user.status,
                        }
                      : m,
                  ),
                },
              }
            : {},
        );
        return;
      }
      case 'SERVER_MEMBER_UPDATE': {
        // Phase 13: aktualisiertes Mitglied (z. B. Timeout gesetzt/aufgehoben).
        const { serverId, member } = d as { serverId: string; member: ServerMember };
        set((s) =>
          s.selectedServer?.id === serverId
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  members: s.selectedServer.members.map((m) =>
                    m.userId === member.userId ? member : m,
                  ),
                },
              }
            : {},
        );
        return;
      }
      case 'ROLE_CREATE': {
        const { role } = d as { role: RoleInfo };
        set((s) =>
          s.selectedServer?.id === role.serverId
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  roles: [...s.selectedServer.roles.filter((r) => r.id !== role.id), role],
                },
              }
            : {},
        );
        return;
      }
      case 'ROLE_UPDATE':
      case 'MEMBER_ROLES_UPDATE': {
        // Berechtigungsänderungen können die eigenen Rechte betreffen →
        // Details (inkl. myPermissions) frisch vom Server holen.
        const serverId =
          (d as { serverId?: string }).serverId ??
          (d as { role?: RoleInfo }).role?.serverId ??
          null;
        if (serverId && get().selectedServer?.id === serverId) {
          void get().selectServer(serverId);
        }
        return;
      }
      case 'ROLE_DELETE': {
        const { serverId, roleId } = d as { serverId: string; roleId: string };
        set((s) =>
          s.selectedServer?.id === serverId
            ? {
                selectedServer: {
                  ...s.selectedServer,
                  roles: s.selectedServer.roles.filter((r) => r.id !== roleId),
                  members: s.selectedServer.members.map((m) => ({
                    ...m,
                    roleIds: m.roleIds.filter((id) => id !== roleId),
                  })),
                },
              }
            : {},
        );
        return;
      }
      case 'CHANNEL_CREATE':
      case 'CHANNEL_UPDATE': {
        const { channel } = d as { channel: ChannelInfo };
        set((s) => {
          if (s.selectedServer?.id !== channel.serverId) return {};
          const channels = [
            ...s.selectedServer.channels.filter((c) => c.id !== channel.id),
            channel,
          ].sort(byPosition);
          return {
            selectedServer: { ...s.selectedServer, channels },
            // Nur Textkanäle automatisch auswählen (Voice-Kanäle öffnen keinen Chat).
            selectedChannelId: s.selectedChannelId ?? (channel.type === 'TEXT' ? channel.id : null),
          };
        });
        return;
      }
      case 'CHANNEL_DELETE': {
        const { serverId, channelId } = d as ChannelDeletePayload;
        set((s) => {
          if (s.selectedServer?.id !== serverId) return {};
          const channels = s.selectedServer.channels.filter((c) => c.id !== channelId);
          return {
            selectedServer: { ...s.selectedServer, channels },
            // Fallback nur auf Textkanäle (Voice-Kanäle öffnen keinen Chat).
            selectedChannelId:
              s.selectedChannelId === channelId
                ? (channels.find((c) => c.type === 'TEXT')?.id ?? null)
                : s.selectedChannelId,
          };
        });
        return;
      }
      default:
        return;
    }
  },

  reset: () => set({ servers: [], selectedServer: null, selectedChannelId: null, loaded: false }),
}));

function toSummary(details: ServerDetails): ServerSummary {
  return {
    id: details.id,
    name: details.name,
    ownerId: details.ownerId,
    iconUrl: details.iconUrl,
    createdAt: details.createdAt,
  };
}
