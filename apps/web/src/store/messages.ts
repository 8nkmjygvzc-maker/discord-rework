import { create } from 'zustand';
import type { MessageHistoryResponse, MessageInfo } from '@parley/shared';
import { useAuthStore } from './auth';

interface ChannelMessages {
  messages: MessageInfo[];
  hasMore: boolean;
  loaded: boolean;
}

/** Nachrichten pro Kanal; History wird beim Kanalwechsel einmal geladen. */
interface MessagesState {
  byChannel: Record<string, ChannelMessages>;

  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string) => Promise<void>;

  handleMessageCreate: (message: MessageInfo) => void;
  reset: () => void;
}

const EMPTY: ChannelMessages = { messages: [], hasMore: false, loaded: false };

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

/** Nachricht einsortieren; Duplikate (REST-Antwort + Gateway-Event) verhindern. */
function appendMessage(state: ChannelMessages, message: MessageInfo): ChannelMessages {
  if (state.messages.some((m) => m.id === message.id)) return state;
  return { ...state, messages: [...state.messages, message] };
}

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  byChannel: {},

  loadHistory: async (channelId) => {
    if (get().byChannel[channelId]?.loaded) return;
    const res = await authFetch<MessageHistoryResponse>(`/api/channels/${channelId}/messages`);
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: { messages: res.messages, hasMore: res.hasMore, loaded: true },
      },
    }));
  },

  loadOlder: async (channelId) => {
    const current = get().byChannel[channelId];
    const oldest = current?.messages[0];
    if (!current?.hasMore || !oldest) return;
    const res = await authFetch<MessageHistoryResponse>(
      `/api/channels/${channelId}/messages?before=${encodeURIComponent(oldest.createdAt)}`,
    );
    set((s) => {
      const chan = s.byChannel[channelId] ?? EMPTY;
      // Ältere Seite vorn anfügen; gegen Duplikate an der Naht schützen.
      const known = new Set(chan.messages.map((m) => m.id));
      const older = res.messages.filter((m) => !known.has(m.id));
      return {
        byChannel: {
          ...s.byChannel,
          [channelId]: { ...chan, messages: [...older, ...chan.messages], hasMore: res.hasMore },
        },
      };
    });
  },

  sendMessage: async (channelId, content) => {
    const message = await authFetch<MessageInfo>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: { content },
    });
    // Sofort anzeigen statt auf das eigene Gateway-Event zu warten.
    get().handleMessageCreate(message);
  },

  handleMessageCreate: (message) =>
    set((s) => {
      const chan = s.byChannel[message.channelId];
      // Kanal nie geöffnet → nichts tun, die History lädt später ohnehin frisch.
      if (!chan?.loaded) return {};
      return { byChannel: { ...s.byChannel, [message.channelId]: appendMessage(chan, message) } };
    }),

  reset: () => set({ byChannel: {} }),
}));
