import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChannelInfo,
  hasPermission,
  MAX_REPLY_PREVIEW_LENGTH,
  Permissions,
  permissionsFromString,
  ReplyRef,
} from '@parley/shared';
import { useMessagesStore } from '../store/messages';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { useDmsStore } from '../store/dms';
import { formatBytes, MAX_FILES_PER_MESSAGE } from '../lib/attachments';
import { memberRoleColor } from '../lib/roleColors';
import {
  MentionPermission,
  mentionPermission,
  requestMentionPermission,
} from '../lib/notifications';
import { findMentions, MentionKind, MentionTargets, mentionsMember } from '../lib/mentions';
import { useUiStore } from '../store/ui';
import MessageRow from './MessageRow';
import { ApiError } from '../lib/api';

interface ChatViewProps {
  channel: ChannelInfo;
  /** DM-Modus (Phase 7): kein Rechte-Gate, @-Präfix statt #. */
  dm?: boolean;
}

/** Deckel fürs Zitat-Nachladen (Phase 15): höchstens 10 Seiten à 50 Nachrichten. */
const MAX_JUMP_PAGES = 10;

/** Frühestens alle 4 s ein Tipp-Ping – der Server verteilt TYPING_START. */
const TYPING_PING_INTERVAL_MS = 4_000;

/** Serverseitiges Limit von notify-mentions (NotifyMentionsDto). */
const MENTION_PUSH_CHUNK = 50;

/** Höchstens so viele Vorschläge im @-Erwähnungs-Picker. */
const MAX_MENTION_SUGGESTIONS = 8;

/** Wartet zwei Frames – bis React nachgeladene Nachrichten gerendert hat. */
function nextRender(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/** Nachrichtenliste + Eingabezeile für den ausgewählten Text- oder DM-Kanal. */
export default function ChatView({ channel, dm = false }: ChatViewProps) {
  const user = useAuthStore((s) => s.user);
  const myPermissions = useServersStore((s) => s.selectedServer?.myPermissions ?? '0');
  const members = useServersStore((s) => s.selectedServer?.members);
  const roles = useServersStore((s) => s.selectedServer?.roles);
  const chan = useMessagesStore((s) => s.byChannel[channel.id]);
  const decrypted = useMessagesStore((s) => s.decrypted);
  const reactions = useMessagesStore((s) => s.reactions);
  const loadHistory = useMessagesStore((s) => s.loadHistory);
  const loadOlder = useMessagesStore((s) => s.loadOlder);
  const sendMessage = useMessagesStore((s) => s.sendMessage);
  const sendReaction = useMessagesStore((s) => s.sendReaction);
  const editMessage = useMessagesStore((s) => s.editMessage);
  const deleteMessage = useMessagesStore((s) => s.deleteMessage);

  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyRef | null>(null);
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [flashId, setFlashId] = useState<string | null>(null);
  const [notifyState, setNotifyState] = useState<MentionPermission>(() => mentionPermission());
  // @-Picker: Index des unterdrückten @ (Esc) und aktiver Vorschlag.
  const [mentionSuppressedAt, setMentionSuppressedAt] = useState<number | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);
  const jumpBusy = useRef(false);
  const lastTypingPing = useRef(0);

  const messages = chan?.messages ?? [];

  /** Erwähnbare Ziele: Mitglieder + Rollen + @everyone bzw. DM-Teilnehmer. */
  const mentionTargets = useMemo<MentionTargets>(() => {
    if (dm) {
      return {
        usernames: user ? [channel.name, user.username] : [channel.name],
        roleNames: [],
        everyone: false,
      };
    }
    return {
      usernames: members?.map((m) => m.username) ?? [],
      // Die Standardrolle gilt für alle – dafür gibt es @everyone.
      roleNames: roles?.filter((r) => !r.isDefault).map((r) => r.name) ?? [],
      everyone: true,
    };
  }, [dm, channel.name, members, roles, user]);

  /** Meine Rollennamen (gelbe Hervorhebung von Rollen-Erwähnungen). */
  const myRoleNames = useMemo(() => {
    if (dm || !members || !roles || !user) return [];
    const mine = new Set(members.find((m) => m.userId === user.id)?.roleIds ?? []);
    return roles.filter((r) => mine.has(r.id)).map((r) => r.name);
  }, [dm, members, roles, user]);

  /** Rollenfarbe je Absender (höchste Rolle mit Farbe, Phase 15). */
  const senderColors = useMemo(() => {
    const map = new Map<string, string>();
    if (dm || !members || !roles) return map;
    for (const member of members) {
      const color = memberRoleColor(roles, member.roleIds);
      if (color) map.set(member.userId, color);
    }
    return map;
  }, [dm, members, roles]);

  /** Profilbild je Absender (Phase 15): Server-Mitglieder bzw. DM-Teilnehmer. */
  const dmChannels = useDmsStore((s) => s.channels);
  const senderAvatars = useMemo(() => {
    const map = new Map<string, string | null>();
    if (dm) {
      if (user) map.set(user.id, user.avatarUrl);
      const other = dmChannels.find((c) => c.id === channel.id)?.otherUser;
      if (other) map.set(other.id, other.avatarUrl);
    } else {
      for (const member of members ?? []) map.set(member.userId, member.avatarUrl);
    }
    return map;
  }, [dm, dmChannels, channel.id, members, user]);

  // Reaktions-Events sind „Nachrichten“, gehören aber nicht in den Verlauf.
  const conversation = useMemo(
    () => messages.filter((m) => !decrypted[m.id]?.reaction),
    [messages, decrypted],
  );

  /** Antwort-Graph (nur entschlüsselte Bezüge): Eltern-ID → Kind-IDs. */
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of conversation) {
      const parent = decrypted[m.id]?.replyTo?.messageId;
      if (!parent) continue;
      map.set(parent, [...(map.get(parent) ?? []), m.id]);
    }
    return map;
  }, [conversation, decrypted]);

  /** Thread-Ansicht: Wurzel (oberster geladener Vorfahre) + alle Nachfahren. */
  const threadIds = useMemo(() => {
    if (!threadRootId) return null;
    const loaded = new Set(conversation.map((m) => m.id));
    let root = threadRootId;
    // `seen` schützt vor Antwort-Zyklen: Mit server-generierten UUIDs können
    // Zyklen zwar nicht entstehen (eine zukünftige ID ist nicht vorhersagbar),
    // aber die Terminierung dieser Schleife soll nicht von dieser Invariante
    // abhängen – replyTo bleibt absenderkontrollierte Eingabe.
    const seen = new Set([root]);
    for (;;) {
      const parent = decrypted[root]?.replyTo?.messageId;
      if (!parent || !loaded.has(parent) || seen.has(parent)) break;
      seen.add(parent);
      root = parent;
    }
    const ids = new Set<string>();
    const queue = [root];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (ids.has(id)) continue;
      ids.add(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return ids;
  }, [threadRootId, conversation, decrypted, childrenByParent]);

  const query = searchQuery.trim().toLowerCase();
  const visible = useMemo(() => {
    let list = conversation;
    if (threadIds) list = list.filter((m) => threadIds.has(m.id));
    if (query) {
      list = list.filter((m) => {
        const content = decrypted[m.id];
        if (!content) return false;
        return (
          content.text.toLowerCase().includes(query) ||
          content.attachments.some((a) => a.name.toLowerCase().includes(query))
        );
      });
    }
    return list;
  }, [conversation, threadIds, query, decrypted]);

  useEffect(() => {
    // Fehler in der Sende-Fehlerzeile anzeigen (z. B. API kurz weg) statt als
    // unbehandelte Rejection; ein Kanalwechsel setzt die Meldung zurück.
    void loadHistory(channel.id).catch(() => {
      setError('Der Nachrichtenverlauf konnte nicht geladen werden.');
    });
  }, [channel.id, loadHistory]);

  // Kanalwechsel: Datei-Auswahl, Antwort-Bezug, Thread und Suche zurücksetzen.
  useEffect(() => {
    setFiles([]);
    setError(null);
    setReplyTo(null);
    setThreadRootId(null);
    setSearchOpen(false);
    setSearchQuery('');
    setMentionSuppressedAt(null);
    lastTypingPing.current = 0;
  }, [channel.id]);

  // Sichtbare DM melden (Phase 15): löscht den Ungelesen-Zähler des Kanals
  // und verhindert, dass live eintreffende Nachrichten ihn wieder erhöhen.
  useEffect(() => {
    if (!dm) return;
    useDmsStore.getState().setActiveDm(channel.id);
    return () => useDmsStore.getState().setActiveDm(null);
  }, [dm, channel.id]);

  // Auto-Scroll ans Ende, solange der Nutzer nicht bewusst hochgescrollt hat.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible.length, channel.id]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function addFiles(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    // SOFORT kopieren: input.files ist eine LIVE-Liste – der onChange-Handler
    // leert den Input direkt nach diesem Aufruf (e.target.value = ''), und
    // Reacts State-Updater läuft erst danach. Ohne Kopie wäre die Auswahl
    // dann bereits leer und Anhänge kamen nie im Draft an (Bug: „Bilder
    // schicken geht nicht").
    const incoming = Array.from(selected);
    setError(null);
    setFiles((prev) => {
      const next = [...prev, ...incoming];
      if (next.length > MAX_FILES_PER_MESSAGE) {
        setError(`Höchstens ${MAX_FILES_PER_MESSAGE} Dateien pro Nachricht`);
        return prev;
      }
      return next;
    });
  }

  function startReply(messageId: string) {
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;
    const content = decrypted[messageId];
    const preview =
      content?.text || (content?.attachments[0] ? `📎 ${content.attachments[0].name}` : '') || '🔒';
    setReplyTo({
      messageId,
      senderId: message.senderId,
      senderUsername: message.senderUsername,
      preview: preview.slice(0, MAX_REPLY_PREVIEW_LENGTH),
    });
  }

  function scrollToMessage(messageId: string): boolean {
    // CSS.escape: Die ID stammt aus dem (absenderkontrollierten) replyTo –
    // ohne Escaping würde z. B. ein `"]` den Selektor-Parser werfen lassen.
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!el) return false;
    stickToBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    setFlashId(messageId);
    window.setTimeout(
      () => setFlashId((current) => (current === messageId ? null : current)),
      1500,
    );
    return true;
  }

  /** „Zum Original springen“ – lädt seit Phase 15 bei Bedarf History nach. */
  async function jumpTo(messageId: string) {
    if (scrollToMessage(messageId)) return;
    if (jumpBusy.current) return;
    jumpBusy.current = true;
    try {
      // Ältere Seiten laden, bis die Nachricht da ist – mit Deckel, damit ein
      // Klick auf ein uraltes (oder gefälschtes) Zitat nicht den kompletten
      // Verlauf durchlädt.
      for (let page = 0; page < MAX_JUMP_PAGES; page++) {
        const state = useMessagesStore.getState().byChannel[channel.id];
        if (!state?.hasMore || state.messages.some((m) => m.id === messageId)) break;
        await loadOlder(channel.id);
      }
      await nextRender();
      if (scrollToMessage(messageId)) return;
      const state = useMessagesStore.getState().byChannel[channel.id];
      if (state?.messages.some((m) => m.id === messageId)) return; // geladen, aber gerade ausgefiltert (Suche/Thread)
      setError(
        state?.hasMore
          ? `Originalnachricht nicht in den letzten ${MAX_JUMP_PAGES * 50} Nachrichten gefunden`
          : 'Originalnachricht nicht gefunden – vermutlich wurde sie gelöscht',
      );
    } finally {
      jumpBusy.current = false;
    }
  }

  function toggleReaction(messageId: string, emoji: string, mine: boolean) {
    sendReaction(channel.id, messageId, emoji, mine ? 'remove' : 'add').catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Reaktion fehlgeschlagen');
    });
  }

  async function handleEdit(messageId: string, newText: string) {
    setError(null);
    try {
      await editMessage(channel.id, messageId, newText);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bearbeiten fehlgeschlagen');
      throw err; // Bearbeitungsfeld offen lassen
    }
  }

  function handleDelete(messageId: string) {
    if (!window.confirm('Diese Nachricht wirklich löschen?')) return;
    setError(null);
    deleteMessage(channel.id, messageId).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    });
  }

  /**
   * Erwähnte Mitglieder auflösen (Verbesserungs-Runde): direkte Nennungen,
   * Rollen-Erwähnungen (alle Träger) und @everyone (alle Mitglieder).
   */
  function resolveMentionedUserIds(content: string): string[] {
    if (dm || !members || !user) return [];
    const ids = new Set<string>();
    let everyone = false;
    const roleNamesHit = new Set<string>();
    for (const m of findMentions(content, mentionTargets)) {
      if (m.kind === 'everyone') everyone = true;
      else if (m.kind === 'role') roleNamesHit.add(m.name.toLowerCase());
      else {
        const member = members.find((x) => x.username.toLowerCase() === m.name.toLowerCase());
        if (member) ids.add(member.userId);
      }
    }
    if (everyone) {
      for (const m of members) ids.add(m.userId);
    } else if (roleNamesHit.size > 0) {
      const roleIds = new Set(
        (roles ?? []).filter((r) => roleNamesHit.has(r.name.toLowerCase())).map((r) => r.id),
      );
      for (const m of members) {
        if (m.roleIds.some((id) => roleIds.has(id))) ids.add(m.userId);
      }
    }
    ids.delete(user.id);
    return [...ids];
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if ((!content && files.length === 0) || sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    stickToBottom.current = true;
    lastTypingPing.current = 0; // nach dem Senden darf sofort wieder gepingt werden
    try {
      await sendMessage(channel.id, content, files, replyTo ?? undefined);
      setFiles([]);
      setReplyTo(null);
      // Erwähnungs-Push (Phase 12): dem Server melden, WEN wir erwähnt haben –
      // er pusht die offline Erwähnten. Erwähnungen stecken im E2EE-Text, der
      // Server kann sie nicht selbst erkennen. Nur in Server-Kanälen; seit der
      // Verbesserungs-Runde inkl. Rollen und @everyone (gestückelt, DTO-Limit).
      const mentioned = content ? resolveMentionedUserIds(content) : [];
      for (let i = 0; i < mentioned.length; i += MENTION_PUSH_CHUNK) {
        void useAuthStore
          .getState()
          .authFetch<void>(`/api/channels/${channel.id}/notify-mentions`, {
            method: 'POST',
            body: { userIds: mentioned.slice(i, i + MENTION_PUSH_CHUNK) },
          })
          .catch(() => undefined);
      }
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Senden fehlgeschlagen',
      );
      // Eingabe nicht verlieren – aber nichts überschreiben, was der Nutzer
      // während des Sendens schon neu getippt hat.
      setDraft((current) => current || content);
    } finally {
      setSending(false);
      // Fokus im Eingabefeld behalten – direkt weiterschreiben können.
      inputRef.current?.focus();
    }
  }

  const canSend =
    dm || hasPermission(permissionsFromString(myPermissions), Permissions.SendMessages);
  const canManageMessages =
    !dm && hasPermission(permissionsFromString(myPermissions), Permissions.ManageMessages);

  // --- „X schreibt …“ (Verbesserungs-Runde) --------------------------------
  const typing = useMessagesStore((s) => s.typing[channel.id]);
  const typingNames = useMemo(() => {
    const now = Date.now();
    return Object.values(typing ?? {})
      .filter((t) => t.expiresAt > now)
      .map((t) => t.username);
  }, [typing]);

  /** Tipp-Ping (gedrosselt) – der Server verteilt TYPING_START an die anderen. */
  function pingTyping() {
    if (!canSend || sending) return;
    const now = Date.now();
    if (now - lastTypingPing.current < TYPING_PING_INTERVAL_MS) return;
    lastTypingPing.current = now;
    void useAuthStore
      .getState()
      .authFetch<void>(`/api/channels/${channel.id}/typing`, { method: 'POST' })
      .catch(() => undefined);
  }

  // --- @-Erwähnungs-Picker (Verbesserungs-Runde) ----------------------------
  // Bezugspunkt ist das Ende des Entwurfs (dort tippt man beim Erwähnen);
  // Rollennamen dürfen Leerzeichen enthalten, deshalb kein Wort-Regex.
  const mentionContext = useMemo(() => {
    if (!canSend) return null;
    const at = draft.lastIndexOf('@');
    if (at === -1) return null;
    // Grenze davor („mail@…“ öffnet keinen Picker).
    if (at > 0 && /[\p{L}\p{N}_.]/u.test(draft[at - 1])) return null;
    const query = draft.slice(at + 1);
    if (query.length > 32 || query.includes('\n')) return null;
    return { at, query: query.toLowerCase() };
  }, [draft, canSend]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionContext || mentionContext.at === mentionSuppressedAt) return [];
    const q = mentionContext.query;
    const out: { kind: MentionKind; name: string; color?: string | null }[] = [];
    if (mentionTargets.everyone && 'everyone'.startsWith(q)) {
      out.push({ kind: 'everyone', name: 'everyone' });
    }
    for (const role of roles ?? []) {
      if (!role.isDefault && role.name.toLowerCase().startsWith(q)) {
        out.push({ kind: 'role', name: role.name, color: role.color });
      }
    }
    for (const name of mentionTargets.usernames) {
      if (name !== user?.username && name.toLowerCase().startsWith(q)) {
        out.push({ kind: 'user', name });
      }
    }
    return out.slice(0, MAX_MENTION_SUGGESTIONS);
  }, [mentionContext, mentionSuppressedAt, mentionTargets, roles, user]);

  // Auswahl zurücksetzen, wenn sich der Kontext ändert.
  useEffect(() => {
    setMentionActiveIdx(0);
  }, [mentionContext?.at, mentionContext?.query]);

  /** Vorschlag übernehmen: @Name + Leerzeichen ersetzt das angefangene @…. */
  function pickMention(name: string) {
    if (!mentionContext) return;
    setDraft((current) => `${current.slice(0, mentionContext.at)}@${name} `);
    inputRef.current?.focus();
  }

  return (
    <main className="animate-view-in flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-zinc-950/50 px-4 py-3 shadow">
        {/* Handy: Kanal-/DM-Sidebar als Drawer öffnen (md+: immer sichtbar). */}
        <button
          type="button"
          title="Navigation anzeigen"
          onClick={() => useUiStore.getState().toggleNav()}
          className="-ml-1 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700/50 md:hidden"
          data-testid="nav-toggle"
        >
          ☰
        </button>
        <span className="text-zinc-500">{dm ? '@' : '#'}</span>
        <span className="min-w-0 truncate font-semibold">{channel.name}</span>
        <span
          className="ml-auto text-xs text-zinc-500"
          title="Nachrichten und Anhänge werden auf deinem Gerät ver- und entschlüsselt – der Server sieht nur Ciphertext."
        >
          🔒<span className="hidden sm:inline"> Ende-zu-Ende-verschlüsselt</span>
        </span>
        <button
          type="button"
          data-testid="notify-toggle"
          title={
            notifyState === 'granted'
              ? 'Erwähnungs-Benachrichtigungen sind aktiv'
              : notifyState === 'denied'
                ? 'Benachrichtigungen im Browser blockiert'
                : notifyState === 'unsupported'
                  ? 'Dieser Browser unterstützt keine Benachrichtigungen'
                  : 'Bei @Erwähnungen benachrichtigen'
          }
          onClick={() => void requestMentionPermission().then(setNotifyState)}
          className={`rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700/50 ${
            notifyState === 'granted' ? '' : 'opacity-40'
          }`}
        >
          🔔
        </button>
        <button
          type="button"
          data-testid="search-toggle"
          title="Im geladenen (entschlüsselten) Verlauf suchen"
          onClick={() => {
            setSearchOpen((open) => !open);
            setSearchQuery('');
          }}
          className={`rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700/50 ${searchOpen ? '' : 'opacity-40'}`}
        >
          🔍
        </button>
        {searchOpen && (
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Suchen …"
            data-testid="search-input"
            className="w-44 max-w-[40vw] rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
        )}
        {!dm && (
          <button
            type="button"
            title="Mitglieder anzeigen"
            onClick={() => useUiStore.getState().toggleMembers()}
            className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-700/50 md:hidden"
            data-testid="members-toggle"
          >
            👥
          </button>
        )}
      </header>

      {threadRootId && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs text-zinc-400">
          <span aria-hidden>🧵</span>
          <span>Thread-Ansicht – {visible.length} Nachricht(en)</span>
          <button
            type="button"
            onClick={() => setThreadRootId(null)}
            className="ml-auto rounded border border-zinc-700 px-2 py-0.5 hover:bg-zinc-700/50"
          >
            Schließen
          </button>
        </div>
      )}
      {query && (
        <div className="border-b border-zinc-800 bg-zinc-900/60 px-4 py-1.5 text-xs text-zinc-400">
          {visible.length} Treffer für „{searchQuery.trim()}“ im geladenen Verlauf
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="chat-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3"
        data-testid="message-list"
      >
        {chan?.hasMore && !threadRootId && (
          <button
            type="button"
            onClick={() =>
              void loadOlder(channel.id).catch(() => {
                setError('Ältere Nachrichten konnten nicht geladen werden.');
              })
            }
            className="mx-auto mb-3 block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700/50"
          >
            Ältere Nachrichten laden
          </button>
        )}
        {chan?.loaded && conversation.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            {dm
              ? `Noch keine Nachrichten mit @${channel.name} – schreib die erste!`
              : `Noch keine Nachrichten in #${channel.name} – schreib die erste!`}
          </p>
        )}
        <ul className="space-y-3">
          {visible.map((msg, i) => {
            const prev = visible[i - 1];
            const content = decrypted[msg.id];
            // Aufeinanderfolgende Nachrichten desselben Absenders gruppieren –
            // Antworten zeigen aber immer den vollen Kopf (wie bei Discord).
            const grouped = prev?.senderId === msg.senderId && !content?.replyTo;
            const mentionsMe =
              !!user &&
              msg.senderId !== user.id &&
              !!content &&
              mentionsMember(content.text, mentionTargets, user.username, myRoleNames);
            return (
              <MessageRow
                key={msg.id}
                message={msg}
                content={content}
                grouped={grouped}
                isOwn={msg.senderId === user?.id}
                mentionsMe={mentionsMe}
                myUserId={user?.id ?? null}
                myUsername={user?.username ?? null}
                mentionTargets={mentionTargets}
                myRoleNames={myRoleNames}
                reactionEvents={reactions[msg.id]}
                canSend={canSend}
                canManageMessages={canManageMessages}
                hasThread={childrenByParent.has(msg.id) || !!content?.replyTo}
                flash={flashId === msg.id}
                senderColor={senderColors.get(msg.senderId) ?? null}
                senderAvatarUrl={senderAvatars.get(msg.senderId) ?? null}
                onToggleReaction={(emoji, mine) => toggleReaction(msg.id, emoji, mine)}
                onReply={() => startReply(msg.id)}
                onOpenThread={() => setThreadRootId(msg.id)}
                onJumpTo={(id) => void jumpTo(id)}
                onEdit={(newText) => handleEdit(msg.id, newText)}
                onDelete={() => handleDelete(msg.id)}
              />
            );
          })}
        </ul>
      </div>

      <form onSubmit={onSubmit} className="shrink-0 px-4 pb-4">
        {error && (
          <p className="mb-2 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}
        {replyTo && (
          <div
            className="mb-2 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400"
            data-testid="reply-banner"
          >
            <span aria-hidden>↩</span>
            <span>
              Antwort an{' '}
              <span className="font-semibold text-zinc-300">@{replyTo.senderUsername}</span>:{' '}
              <span className="text-zinc-500">{replyTo.preview}</span>
            </span>
            <button
              type="button"
              title="Antwort-Bezug entfernen"
              onClick={() => setReplyTo(null)}
              className="ml-auto text-zinc-500 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )}
        {files.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" data-testid="pending-files">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-300"
              >
                <span aria-hidden>{file.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                <span className="max-w-48 truncate">{file.name}</span>
                <span className="text-zinc-500">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  title="Entfernen"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  className="text-zinc-500 hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Die UI blendet nur aus – blockiert wird serverseitig (403). */}
        {canSend ? (
          <div className="relative flex items-center gap-2">
            {/* @-Erwähnungs-Picker: über der Eingabezeile, Pfeiltasten + Enter/Tab. */}
            {mentionSuggestions.length > 0 && (
              <div
                className="animate-pop-in absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
                data-testid="mention-picker"
              >
                {mentionSuggestions.map((s, i) => (
                  <button
                    key={`${s.kind}|${s.name}`}
                    type="button"
                    // onMouseDown statt onClick: der Klick darf den Fokus nicht
                    // aus dem Eingabefeld ziehen (blur käme vor click).
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(s.name);
                    }}
                    onMouseEnter={() => setMentionActiveIdx(i)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      i === mentionActiveIdx ? 'bg-indigo-600/30 text-zinc-100' : 'text-zinc-300'
                    }`}
                  >
                    {s.kind === 'role' ? (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color ?? '#71717a' }}
                        aria-hidden
                      />
                    ) : (
                      <span className="w-2.5 shrink-0 text-center text-zinc-500" aria-hidden>
                        @
                      </span>
                    )}
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-zinc-500">
                      {s.kind === 'everyone'
                        ? 'alle Mitglieder'
                        : s.kind === 'role'
                          ? 'Rolle'
                          : 'Mitglied'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = ''; // gleiche Datei erneut wählbar
              }}
              data-testid="file-input"
            />
            <button
              type="button"
              title="Datei anhängen (verschlüsselt)"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
            >
              📎
            </button>
            <input
              ref={inputRef}
              // Bewusst NICHT disabled beim Senden: der Fokus bleibt erhalten
              // und man kann sofort weiterschreiben (Verbesserungs-Runde).
              className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (e.target.value.trim()) pingTyping();
              }}
              onKeyDown={(e) => {
                if (mentionSuggestions.length === 0) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const delta = e.key === 'ArrowDown' ? 1 : -1;
                  setMentionActiveIdx(
                    (i) => (i + delta + mentionSuggestions.length) % mentionSuggestions.length,
                  );
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pickMention(mentionSuggestions[mentionActiveIdx].name);
                } else if (e.key === 'Escape') {
                  setMentionSuppressedAt(mentionContext?.at ?? null);
                }
              }}
              placeholder={`Nachricht an ${dm ? '@' : '#'}${channel.name}`}
              maxLength={4000}
            />
          </div>
        ) : (
          <p
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-sm text-zinc-500"
            data-testid="no-send-permission"
          >
            Du hast keine Berechtigung, in #{channel.name} zu schreiben.
          </p>
        )}
        {/* „X schreibt …“ – feste Höhe, damit die Eingabezeile nicht springt. */}
        <div className="h-5 px-1 pt-0.5 text-xs text-zinc-400" data-testid="typing-indicator">
          {typingNames.length > 0 && (
            <span className="animate-pulse">
              ✏️{' '}
              {typingNames.length === 1
                ? `${typingNames[0]} schreibt …`
                : typingNames.length === 2
                  ? `${typingNames[0]} und ${typingNames[1]} schreiben …`
                  : 'Mehrere Personen schreiben …'}
            </span>
          )}
        </div>
      </form>
    </main>
  );
}
