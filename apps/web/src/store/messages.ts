import { create } from 'zustand';
import {
  AttachmentMeta,
  decodeMessageContent,
  DecodedMessageContent,
  encodeMessageContent,
  encodeReactionContent,
  MessageHistoryResponse,
  MessageInfo,
  ReplyRef,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { useServersStore } from './servers';
import { dmMemberIds, useDmsStore } from './dms';
import { e2ee } from '../lib/e2ee';
import { collectAttachmentIds, uploadAttachment } from '../lib/attachments';
import { mentionsUser } from '../lib/mentions';
import { notifyMention, recallChannelLabel } from '../lib/notifications';

interface ChannelMessages {
  messages: MessageInfo[];
  hasMore: boolean;
  loaded: boolean;
}

/** Letzter bekannter Reaktions-Stand eines Nutzers für ein Emoji auf ein Ziel. */
export interface ReactionEventState {
  action: 'add' | 'remove';
  createdAt: string;
  /** ID des Reaktions-Events – Tiebreaker bei gleichem Server-Zeitstempel. */
  eventId: string;
  username: string;
}

/**
 * Nachrichten pro Kanal. Seit Phase 6 kommen sie als Ciphertext an –
 * `decrypted` hält die entschlüsselten Inhalte NUR IM SPEICHER (nie
 * persistiert); seit Phase 8 strukturiert (Text + Anhangs-Metadaten inkl.
 * Dateischlüssel). Fehlt der Sender-Key noch, bleibt der Eintrag aus und die
 * UI zeigt einen Platzhalter; nach jedem Schlüssel-Umschlag wird erneut
 * versucht (retryUndecrypted).
 *
 * Phase 9: Reaktionen sind verschlüsselte Spezial-Nachrichten in derselben
 * Pipeline. Nach dem Entschlüsseln landen sie NICHT in der sichtbaren Liste,
 * sondern werden in `reactions` gefaltet: pro Ziel-Nachricht und
 * (Nutzer, Emoji) gewinnt das Event mit dem jüngsten Zeitstempel
 * (add/remove-Toggle). Aggregation (Zähler, „von mir“) macht die UI.
 */
interface MessagesState {
  byChannel: Record<string, ChannelMessages>;
  decrypted: Record<string, DecodedMessageContent>;
  /** targetMessageId → `${userId}|${emoji}` → letzter Stand. */
  reactions: Record<string, Record<string, ReactionEventState>>;

  loadHistory: (channelId: string) => Promise<void>;
  loadOlder: (channelId: string) => Promise<void>;
  sendMessage: (
    channelId: string,
    content: string,
    files?: File[],
    replyTo?: ReplyRef,
  ) => Promise<void>;
  sendReaction: (
    channelId: string,
    targetMessageId: string,
    emoji: string,
    action: 'add' | 'remove',
  ) => Promise<void>;
  /** Eigene Nachricht bearbeiten (Phase 13) – Text neu verschlüsseln. */
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  /** Nachricht löschen (Autor oder Moderation, Phase 13). */
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;

  handleMessageCreate: (message: MessageInfo) => void;
  handleMessageUpdate: (message: MessageInfo, content?: DecodedMessageContent) => void;
  handleMessageDelete: (channelId: string, messageId: string) => void;
  retryUndecrypted: () => void;
  reset: () => void;
}

const EMPTY: ChannelMessages = { messages: [], hasMore: false, loaded: false };

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

/** Nachricht einsortieren; Duplikate (REST-Antwort + Gateway-Event) verhindern. */
function appendMessage(state: ChannelMessages, message: MessageInfo): ChannelMessages {
  if (state.messages.some((m) => m.id === message.id)) return state;
  return { ...state, messages: [...state.messages, message] };
}

/**
 * Sende-Kontext eines Kanals: Server-Kanal des ausgewählten Servers oder
 * eigener DM-Kanal (serverId bleibt dann null).
 */
function resolveChannelContext(channelId: string): {
  serverId: string | null;
  memberIds: string[];
} {
  const server = useServersStore.getState().selectedServer;
  if (server?.channels.some((c) => c.id === channelId)) {
    return { serverId: server.id, memberIds: server.members.map((m) => m.userId) };
  }
  const dm = dmMemberIds(channelId);
  if (!dm) throw new Error('Kanal nicht gefunden');
  return { serverId: null, memberIds: dm };
}

export const useMessagesStore = create<MessagesState>()((set, get) => ({
  byChannel: {},
  decrypted: {},
  reactions: {},

  loadHistory: async (channelId) => {
    if (get().byChannel[channelId]?.loaded) return;
    const res = await authFetch<MessageHistoryResponse>(`/api/channels/${channelId}/messages`);
    set((s) => ({
      byChannel: {
        ...s.byChannel,
        [channelId]: { messages: res.messages, hasMore: res.hasMore, loaded: true },
      },
    }));
    void decryptBatch(res.messages, set, get, false);
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
    void decryptBatch(res.messages, set, get, false);
  },

  sendMessage: async (channelId, content, files = [], replyTo) => {
    const { serverId, memberIds } = resolveChannelContext(channelId);

    // Anhänge zuerst: verschlüsseln + hochladen; die Metadaten (inkl.
    // Dateischlüssel) reisen gleich im E2EE-Klartext mit.
    const attachments: AttachmentMeta[] = [];
    for (const file of files) attachments.push(await uploadAttachment(channelId, file));

    // Verschlüsseln (verteilt bei Bedarf vorher den eigenen Sender-Key).
    const plaintext = encodeMessageContent(content, attachments, replyTo);
    const payload = await e2ee.encryptForChannel(channelId, serverId, memberIds, plaintext);
    const attachmentIds = collectAttachmentIds(attachments);
    const message = await authFetch<MessageInfo>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: { ...payload, ...(attachmentIds.length > 0 ? { attachmentIds } : {}) },
    });
    // Eigenen Klartext direkt eintragen – kein Entschlüsselungs-Umweg nötig.
    set((s) => ({
      decrypted: {
        ...s.decrypted,
        [message.id]: { text: content, attachments, replyTo: replyTo ?? null, reaction: null },
      },
    }));
    get().handleMessageCreate(message);
  },

  sendReaction: async (channelId, targetMessageId, emoji, action) => {
    const { serverId, memberIds } = resolveChannelContext(channelId);
    const plaintext = encodeReactionContent(targetMessageId, emoji, action);
    const payload = await e2ee.encryptForChannel(channelId, serverId, memberIds, plaintext);
    const message = await authFetch<MessageInfo>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: payload,
    });
    // Eigenes Event direkt eintragen (kein Entschlüsselungs-Umweg).
    const content = decodeMessageContent(plaintext);
    set((s) => ({
      decrypted: { ...s.decrypted, [message.id]: content },
      reactions: foldReactions(s.reactions, [{ message, content }]),
    }));
    get().handleMessageCreate(message);
  },

  editMessage: async (channelId, messageId, content) => {
    const { serverId, memberIds } = resolveChannelContext(channelId);
    // Anhänge und Antwort-Bezug der Originalnachricht erhalten (ihre
    // Dateischlüssel stecken im Klartext – ginge sonst beim Neu-Verschlüsseln
    // verloren). Nur der Text wird ersetzt.
    const existing = get().decrypted[messageId];
    const plaintext = encodeMessageContent(
      content,
      existing?.attachments ?? [],
      existing?.replyTo ?? undefined,
    );
    const payload = await e2ee.encryptForChannel(channelId, serverId, memberIds, plaintext);
    const message = await authFetch<MessageInfo>(
      `/api/channels/${channelId}/messages/${messageId}`,
      { method: 'PATCH', body: payload },
    );
    get().handleMessageUpdate(message, decodeMessageContent(plaintext));
  },

  deleteMessage: async (channelId, messageId) => {
    await authFetch<void>(`/api/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
    get().handleMessageDelete(channelId, messageId);
  },

  handleMessageCreate: (message) => {
    set((s) => {
      const chan = s.byChannel[message.channelId];
      // Kanal nie geöffnet → nichts tun, die History lädt später ohnehin frisch.
      if (!chan?.loaded) return {};
      return { byChannel: { ...s.byChannel, [message.channelId]: appendMessage(chan, message) } };
    });
    void decryptBatch([message], set, get, true);
  },

  /**
   * Bearbeitete Nachricht einspielen (Phase 13). `content` = bekannter Klartext
   * (eigene Bearbeitung, kein Flackern); ohne `content` wird der geänderte
   * Ciphertext frisch entschlüsselt.
   */
  handleMessageUpdate: (message, content) => {
    set((s) => {
      const next: Partial<MessagesState> = {};
      const chan = s.byChannel[message.channelId];
      if (chan) {
        next.byChannel = {
          ...s.byChannel,
          [message.channelId]: {
            ...chan,
            messages: chan.messages.map((m) => (m.id === message.id ? message : m)),
          },
        };
      }
      if (content) {
        next.decrypted = { ...s.decrypted, [message.id]: content };
      } else {
        const rest = { ...s.decrypted };
        delete rest[message.id];
        next.decrypted = rest;
      }
      return next;
    });
    if (!content) void decryptBatch([message], set, get, false);
  },

  /** Gelöschte Nachricht entfernen (idempotent – REST-Aufruf UND Gateway-Event). */
  handleMessageDelete: (channelId, messageId) => {
    set((s) => {
      const next: Partial<MessagesState> = {};
      const chan = s.byChannel[channelId];
      if (chan) {
        next.byChannel = {
          ...s.byChannel,
          [channelId]: { ...chan, messages: chan.messages.filter((m) => m.id !== messageId) },
        };
      }
      if (s.decrypted[messageId] !== undefined) {
        const rest = { ...s.decrypted };
        delete rest[messageId];
        next.decrypted = rest;
      }
      // Reaktions-Stände, die auf die gelöschte Nachricht zeigen, mit entfernen.
      if (s.reactions[messageId] !== undefined) {
        const rest = { ...s.reactions };
        delete rest[messageId];
        next.reactions = rest;
      }
      return next;
    });
  },

  /** Nach neuen Sender-Keys: alles noch Unentschlüsselte erneut versuchen. */
  retryUndecrypted: () => {
    const { byChannel } = get();
    const pending = Object.values(byChannel).flatMap((chan) => chan.messages);
    void decryptBatch(pending, set, get, false);
  },

  reset: () => set({ byChannel: {}, decrypted: {}, reactions: {} }),
}));

type Set = (fn: (s: MessagesState) => Partial<MessagesState>) => void;
type Get = () => MessagesState;

/**
 * Live empfangene, aber (noch) nicht entschlüsselbare Nachrichten (Phase 15):
 * Nachricht und Sender-Key-Umschlag treffen praktisch gleichzeitig ein, die
 * Live-Entschlüsselung verliert das Rennen. Gelingt sie später über
 * retryUndecrypted (live=false), sollen die Live-Effekte – DM-Ungelesen-Zähler
 * und Erwähnungs-Benachrichtigung – trotzdem laufen. Der Deckel schützt vor
 * unbegrenztem Wachstum durch nie entschlüsselbare Events.
 */
const pendingLiveIds = new Set<string>();
const PENDING_LIVE_LIMIT = 500;

/**
 * Entschlüsselt fehlende Nachrichten und trägt Ergebnisse gesammelt ein.
 * `live` = frisch über das Gateway angekommen (nicht History): nur solche
 * Nachrichten (bzw. ihre Nachzügler, s. o.) lösen Live-Effekte aus.
 */
async function decryptBatch(
  messages: MessageInfo[],
  set: Set,
  get: Get,
  live: boolean,
): Promise<void> {
  const results: { message: MessageInfo; content: DecodedMessageContent }[] = [];
  const liveResults: { message: MessageInfo; content: DecodedMessageContent }[] = [];
  for (const message of messages) {
    if (get().decrypted[message.id] !== undefined) continue;
    const plaintext = await e2ee.decryptMessage(message);
    if (plaintext === null) {
      if (live) {
        pendingLiveIds.add(message.id);
        if (pendingLiveIds.size > PENDING_LIVE_LIMIT) {
          const oldest = pendingLiveIds.values().next().value;
          if (oldest !== undefined) pendingLiveIds.delete(oldest);
        }
      }
      continue;
    }
    const content = decodeMessageContent(plaintext);
    results.push({ message, content });
    if (live || pendingLiveIds.delete(message.id)) liveResults.push({ message, content });
  }
  if (results.length === 0) return;

  set((s) => ({
    decrypted: {
      ...s.decrypted,
      ...Object.fromEntries(results.map((r) => [r.message.id, r.content])),
    },
    reactions: foldReactions(s.reactions, results),
  }));

  const me = useAuthStore.getState().user;
  for (const { message, content } of liveResults) {
    if (!me || message.senderId === me.id || content.reaction) continue;
    // DM-Ungelesen-Badge (Phase 15): erst NACH dem Entschlüsseln zählen,
    // damit Reaktions-Events den Zähler nicht fälschlich erhöhen. Der Store
    // ignoriert Kanäle, die keine DMs sind oder gerade sichtbar sind.
    useDmsStore.getState().markUnread(message.channelId);
    if (mentionsUser(content.text, me.username)) {
      notifyMention(message.senderUsername, channelLabel(message.channelId), content.text);
    }
  }
}

/**
 * Reaktions-Events einfalten: pro (Ziel, Nutzer, Emoji) gewinnt das jüngste.
 * Bei gleichem Server-Zeitstempel (Millisekunden-Auflösung!) entscheidet die
 * Event-ID – sonst könnten Clients je nach Verarbeitungs-Reihenfolge dauerhaft
 * unterschiedliche Stände zeigen.
 */
function foldReactions(
  reactions: MessagesState['reactions'],
  results: { message: MessageInfo; content: DecodedMessageContent }[],
): MessagesState['reactions'] {
  let changed = false;
  const next = { ...reactions };
  for (const { message, content } of results) {
    const reaction = content.reaction;
    if (!reaction) continue;
    const byUserEmoji = { ...(next[reaction.targetMessageId] ?? {}) };
    const key = `${message.senderId}|${reaction.emoji}`;
    const existing = byUserEmoji[key];
    if (
      existing &&
      (existing.createdAt > message.createdAt ||
        (existing.createdAt === message.createdAt && existing.eventId >= message.id))
    ) {
      continue;
    }
    byUserEmoji[key] = {
      action: reaction.action,
      createdAt: message.createdAt,
      eventId: message.id,
      username: message.senderUsername,
    };
    next[reaction.targetMessageId] = byUserEmoji;
    changed = true;
  }
  return changed ? next : reactions;
}

/** Anzeigename des Kanals für Benachrichtigungen („#kanal“ bzw. „@nutzer“). */
function channelLabel(channelId: string): string {
  const server = useServersStore.getState().selectedServer;
  const channel = server?.channels.find((c) => c.id === channelId);
  if (channel) return `#${channel.name}`;
  const dm = useDmsStore.getState().channels.find((c) => c.id === channelId);
  if (dm) return `@${dm.otherUser.username}`;
  // Nicht ausgewählter Server: Label aus dem MESSAGE_CREATE-Kontext (Phase 15).
  return recallChannelLabel(channelId) ?? 'einem Kanal';
}
