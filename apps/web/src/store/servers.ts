import { create } from 'zustand';
import type {
  ChannelDeletePayload,
  ChannelInfo,
  GatewayEventType,
  ServerDeletePayload,
  ServerDetails,
  ServerMember,
  ServerMemberRemovePayload,
  ServerSummary,
} from '@parley/shared';
import { useAuthStore } from './auth';

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
  joinServer: (serverId: string) => Promise<void>;
  leaveServer: (serverId: string) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  createChannel: (name: string) => Promise<void>;
  deleteChannel: (channelId: string) => Promise<void>;

  /** Echtzeit-Updates aus dem Gateway (siehe lib/gatewayConnection.ts). */
  handleGatewayEvent: (t: GatewayEventType, d: unknown) => void;
  reset: () => void;
}

const byPosition = (a: ChannelInfo, b: ChannelInfo): number => a.position - b.position;

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
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
      return;
    }
    const details = await authFetch<ServerDetails>(`/api/servers/${serverId}`);
    set((s) => ({
      selectedServer: details,
      // Kanalauswahl behalten, wenn der Kanal noch existiert, sonst erster Kanal.
      selectedChannelId: details.channels.some((c) => c.id === s.selectedChannelId)
        ? s.selectedChannelId
        : (details.channels[0]?.id ?? null),
    }));
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
      selectedChannelId: details.channels[0]?.id ?? null,
    }));
  },

  joinServer: async (serverId) => {
    const details = await authFetch<ServerDetails>(`/api/servers/${serverId}/join`, {
      method: 'POST',
    });
    set((s) => ({
      servers: [...s.servers.filter((x) => x.id !== details.id), toSummary(details)],
      selectedServer: details,
      selectedChannelId: details.channels[0]?.id ?? null,
    }));
  },

  leaveServer: async (serverId) => {
    await authFetch<void>(`/api/servers/${serverId}/leave`, { method: 'POST' });
    get().handleGatewayEvent('SERVER_DELETE', { serverId } satisfies ServerDeletePayload);
  },

  deleteServer: async (serverId) => {
    await authFetch<void>(`/api/servers/${serverId}`, { method: 'DELETE' });
    get().handleGatewayEvent('SERVER_DELETE', { serverId } satisfies ServerDeletePayload);
  },

  createChannel: async (name) => {
    const serverId = get().selectedServer?.id;
    if (!serverId) return;
    // Der Kanal kommt zusätzlich als CHANNEL_CREATE-Event zurück; das Update
    // hier sorgt nur dafür, dass der Ersteller nicht auf das Event warten muss.
    const channel = await authFetch<ChannelInfo>(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      body: { name },
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
            selectedChannelId: s.selectedChannelId ?? channel.id,
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
            selectedChannelId:
              s.selectedChannelId === channelId ? (channels[0]?.id ?? null) : s.selectedChannelId,
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
