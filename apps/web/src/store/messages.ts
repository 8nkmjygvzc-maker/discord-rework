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
  StickerRef,
  TypingStartPayload,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { useServersStore } from './servers';
import { dmMemberIds, useDmsStore } from './dms';
import { e2ee } from '../lib/e2ee';
import { buildEmbeds } from '../lib/unfurl';
import { collectAttachmentIds, uploadAttachment } from '../lib/attachments';
import { mentionsMember, mentionsUser } from '../lib/mentions';
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
  /** channelId → userId → „schreibt gerade“ (verfällt nach TYPING_TTL_MS). */
  typing: Record<string, Record<string, { username: string; expiresAt: number }>>;

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
  /** Server-Sticker als eigene Nachricht verschicken (Referenz reist E2EE). */
  sendSticker: (channelId: string, sticker: StickerRef, replyTo?: ReplyRef) => Promise<void>;
  /** Eigene Nachricht bearbeiten (Phase 13) – Text neu verschlüsseln. */
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>;
  /** Nachricht löschen (Autor oder Moderation, Phase 13). */
  deleteMessage: (channelId: string, messageId: string) => Promise<void>;

  handleMessageCreate: (message: MessageInfo) => void;
  /** „X schreibt …“ (TYPING_START); verfällt automatisch. */
  handleTypingStart: (d: TypingStartPayload) => void;
  handleMessageUpdate: (message: MessageInfo, content?: DecodedMessageContent) => void;
  handleMessageDelete: (channelId: string, messageId: string) => void;
  retryUndecrypted: () => void;
  reset: () => void;
}

const EMPTY: ChannelMessages = { messages: [], hasMore: false, loaded: false };

/** Ohne neues TYPING_START verschwindet „X schreibt …“ nach dieser Zeit. */
const TYPING_TTL_MS = 8_000;

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
  typing: {},

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

    // Link-Vorschauen (automatisch beim Senden): Der Server holt die Metadaten,
    // sie reisen dann IM E2EE-Klartext mit. Best-effort – blockiert nicht.
    const embeds = await buildEmbeds(content);

    // Verschlüsseln (verteilt bei Bedarf vorher den eigenen Sender-Key).
    const plaintext = encodeMessageContent(content, attachments, replyTo, embeds);
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
        [message.id]: {
          text: content,
          attachments,
          replyTo: replyTo ?? null,
          reaction: null,
          embeds,
          sticker: null,
        },
      },
    }));
    get().handleMessageCreate(message);
  },

  sendSticker: async (channelId, sticker, replyTo) => {
    const { serverId, memberIds } = resolveChannelContext(channelId);
    // Gleiche Pipeline wie Textnachrichten: Die Sticker-Referenz steht IM
    // E2EE-Klartext, der Server sieht eine ganz normale (kleine) Nachricht.
    const plaintext = encodeMessageContent('', [], replyTo, [], sticker);
    const payload = await e2ee.encryptForChannel(channelId, serverId, memberIds, plaintext);
    const message = await authFetch<MessageInfo>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: payload,
    });
    // Eigenen Klartext direkt eintragen – kein Entschlüsselungs-Umweg nötig.
    set((s) => ({
      decrypted: { ...s.decrypted, [message.id]: decodeMessageContent(plaintext) },
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
      existing?.embeds ?? [],
      existing?.sticker ?? undefined,
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
    // DM-Liste nach Aktivität sortiert halten (ignoriert Server-Kanäle).
    useDmsStore.getState().bumpActivity(message.channelId, message.createdAt);
    set((s) => {
      const next: Partial<MessagesState> = {};
      // Wer eine Nachricht abschickt, tippt nicht mehr → Anzeige sofort weg.
      const chanTyping = s.typing[message.channelId];
      if (chanTyping?.[message.senderId]) {
        const rest = { ...chanTyping };
        delete rest[message.senderId];
        next.typing = { ...s.typing, [message.channelId]: rest };
      }
      const chan = s.byChannel[message.channelId];
      // Kanal nie geöffnet → History lädt später ohnehin frisch.
      if (chan?.loaded) {
        next.byChannel = { ...s.byChannel, [message.channelId]: appendMessage(chan, message) };
      }
      return next;
    });
    void decryptBatch([message], set, get, true);
  },

  handleTypingStart: (d) => {
    // Der eigene Nutzer (anderer Tab) braucht keine Anzeige.
    if (d.userId === useAuthStore.getState().user?.id) return;
    set((s) => ({
      typing: {
        ...s.typing,
        [d.channelId]: {
          ...(s.typing[d.channelId] ?? {}),
          [d.userId]: { username: d.username, expiresAt: Date.now() + TYPING_TTL_MS },
        },
      },
    }));
    // Verfall: kurz nach Ablauf alle abgelaufenen Einträge entfernen (löst das
    // Re-Render aus, das die Anzeige ausblendet).
    setTimeout(() => {
      const now = Date.now();
      set((s) => {
        let changed = false;
        const typing: MessagesState['typing'] = {};
        for (const [channelId, users] of Object.entries(s.typing)) {
          const alive = Object.fromEntries(
            Object.entries(users).filter(([, v]) => v.expiresAt > now),
          );
          if (Object.keys(alive).length < Object.keys(users).length) changed = true;
          if (Object.keys(alive).length > 0) typing[channelId] = alive;
        }
        return changed ? { typing } : {};
      });
    }, TYPING_TTL_MS + 200);
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
    // Live-Nachzügler nie geöffneter Kanäle mitversuchen (s. pendingLive).
    const known = new Set(pending.map((m) => m.id));
    for (const message of pendingLive.values()) {
      if (!known.has(message.id)) pending.push(message);
    }
    void decryptBatch(pending, set, get, false);
  },

  reset: () => {
    // Sonst gälten nach einem Re-Login alte History-Nachrichten als „live“.
    pendingLive.clear();
    set({ byChannel: {}, decrypted: {}, reactions: {}, typing: {} });
  },
}));

type Set = (fn: (s: MessagesState) => Partial<MessagesState>) => void;
type Get = () => MessagesState;

/**
 * Live empfangene, aber (noch) nicht entschlüsselbare Nachrichten (Phase 15):
 * Nachricht und Sender-Key-Umschlag treffen praktisch gleichzeitig ein, die
 * Live-Entschlüsselung verliert das Rennen. Gelingt sie später über
 * retryUndecrypted (live=false), sollen die Live-Effekte – DM-Ungelesen-Zähler
 * und Erwähnungs-Benachrichtigung – trotzdem laufen. Die ganze MessageInfo
 * (nicht nur die ID) wird gemerkt, weil Nachrichten NIE geöffneter Kanäle
 * nicht in `byChannel` landen – der Normalfall bei DMs – und retryUndecrypted
 * sie sonst nirgends wiederfände. Der Deckel schützt vor unbegrenztem
 * Wachstum durch nie entschlüsselbare Events.
 */
const pendingLive = new Map<string, MessageInfo>();
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
        pendingLive.set(message.id, message);
        if (pendingLive.size > PENDING_LIVE_LIMIT) {
          const oldest = pendingLive.keys().next().value;
          if (oldest !== undefined) pendingLive.delete(oldest);
        }
      }
      continue;
    }
    const content = decodeMessageContent(plaintext);
    results.push({ message, content });
    if (live || pendingLive.delete(message.id)) liveResults.push({ message, content });
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
    if (isMentioningMe(message.channelId, content.text, me)) {
      notifyMention(message.senderUsername, channelLabel(message.channelId), content.text);
    }
  }
}

/**
 * Bin ich in diesem Text gemeint? Im ausgewählten Server zählen auch meine
 * Rollen und @everyone; in DMs nur der direkte Name; für Kanäle NICHT
 * ausgewählter Server fehlen die Rollennamen – dort greifen nur @benutzername
 * und @everyone.
 */
function isMentioningMe(
  channelId: string,
  text: string,
  me: { id: string; username: string },
): boolean {
  const server = useServersStore.getState().selectedServer;
  if (server?.channels.some((c) => c.id === channelId)) {
    const roleNames = server.roles.filter((r) => !r.isDefault).map((r) => r.name);
    const myRoleIds = new Set(server.members.find((m) => m.userId === me.id)?.roleIds ?? []);
    const myRoleNames = server.roles.filter((r) => myRoleIds.has(r.id)).map((r) => r.name);
    return mentionsMember(
      text,
      { usernames: [me.username], roleNames, everyone: true },
      me.username,
      myRoleNames,
    );
  }
  if (useDmsStore.getState().channels.some((c) => c.id === channelId)) {
    return mentionsUser(text, me.username);
  }
  return mentionsMember(
    text,
    { usernames: [me.username], roleNames: [], everyone: true },
    me.username,
    [],
  );
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
