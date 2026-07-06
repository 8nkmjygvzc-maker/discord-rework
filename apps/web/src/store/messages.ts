import { create } from 'zustand';
import type { MessageHistoryResponse, MessageInfo } from '@parley/shared';
import { useAuthStore } from './auth';
import { useServersStore } from './servers';
import { dmMemberIds } from './dms';
import { e2ee } from '../lib/e2ee';

interface ChannelMessages {
  messages: MessageInfo[];
  hasMore: boolean;
  loaded: boolean;
}

/**
 * Nachrichten pro Kanal. Seit Phase 6 kommen sie als Ciphertext an –
 * `decrypted` hält die entschlüsselten Texte NUR IM SPEICHER (nie
 * persistiert). Fehlt der Sender-Key noch, bleibt der Eintrag aus und die
 * UI zeigt einen Platzhalter; nach jedem Schlüssel-Umschlag wird erneut
 * versucht (retryUndecrypted).
 */
interface MessagesState {
  byChannel: Record<string, ChannelMessages>;
  decrypted: Record<string, string>;

  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  sendMessage: (channelId: string, content: string) => Promise<void>;

  handleMessageCreate: (message: MessageInfo) => void;
  retryUndecrypted: () => void;
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
  decrypted: {},

  loadHistory: async (channelId) => {
    if (get().byChannel[channelId]?.loaded) return;
    const res = await authFetch<MessageHistoryResponse>(`/api/channels/${channelId}/messages`);
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: { messages: res.messages, hasMore: res.hasMore, loaded: true },
      },
    }));
    void decryptBatch(res.messages, set, get);
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
    void decryptBatch(res.messages, set, get);
  },

  sendMessage: async (channelId, content) => {
    // Kontext bestimmen: Kanal des ausgewählten Servers oder eigener DM-Kanal.
    const server = useServersStore.getState().selectedServer;
    let serverId: string | null = null;
    let memberIds: string[];
    if (server?.channels.some((c) => c.id === channelId)) {
      serverId = server.id;
      memberIds = server.members.map((m) => m.userId);
    } else {
      const dm = dmMemberIds(channelId);
      if (!dm) throw new Error('Kanal nicht gefunden');
      memberIds = dm;
    }
    // Verschlüsseln (verteilt bei Bedarf vorher den eigenen Sender-Key).
    const payload = await e2ee.encryptForChannel(channelId, serverId, memberIds, content);
    const message = await authFetch<MessageInfo>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: payload,
    });
    // Eigenen Klartext direkt eintragen – kein Entschlüsselungs-Umweg nötig.
    set((s) => ({ decrypted: { ...s.decrypted, [message.id]: content } }));
    get().handleMessageCreate(message);
  },

  handleMessageCreate: (message) => {
    set((s) => {
      const chan = s.byChannel[message.channelId];
      // Kanal nie geöffnet → nichts tun, die History lädt später ohnehin frisch.
      if (!chan?.loaded) return {};
      return { byChannel: { ...s.byChannel, [message.channelId]: appendMessage(chan, message) } };
    });
    void decryptBatch([message], set, get);
  },

  /** Nach neuen Sender-Keys: alles noch Unentschlüsselte erneut versuchen. */
  retryUndecrypted: () => {
    const { byChannel } = get();
    const pending = Object.values(byChannel).flatMap((chan) => chan.messages);
    void decryptBatch(pending, set, get);
  },

  reset: () => set({ byChannel: {}, decrypted: {} }),
}));

type Set = (fn: (s: MessagesState) => Partial<MessagesState>) => void;
type Get = () => MessagesState;

/** Entschlüsselt fehlende Nachrichten und trägt Ergebnisse gesammelt ein. */
async function decryptBatch(messages: MessageInfo[], set: Set, get: Get): Promise<void> {
  const results: Record<string, string> = {};
  for (const message of messages) {
    if (get().decrypted[message.id] !== undefined) continue;
    const plaintext = await e2ee.decryptMessage(message);
    if (plaintext !== null) results[message.id] = plaintext;
  }
  if (Object.keys(results).length > 0) {
    set((s) => ({ decrypted: { ...s.decrypted, ...results } }));
  }
}
