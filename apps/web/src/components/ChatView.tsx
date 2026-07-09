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
import { formatBytes, MAX_FILES_PER_MESSAGE } from '../lib/attachments';
import {
  MentionPermission,
  mentionPermission,
  requestMentionPermission,
} from '../lib/notifications';
import { mentionsUser } from '../lib/mentions';
import MessageRow from './MessageRow';
import { ApiError } from '../lib/api';

interface ChatViewProps {
  channel: ChannelInfo;
  /** DM-Modus (Phase 7): kein Rechte-Gate, @-Präfix statt #. */
  dm?: boolean;
}

/** Nachrichtenliste + Eingabezeile für den ausgewählten Text- oder DM-Kanal. */
export default function ChatView({ channel, dm = false }: ChatViewProps) {
  const user = useAuthStore((s) => s.user);
  const myPermissions = useServersStore((s) => s.selectedServer?.myPermissions ?? '0');
  const members = useServersStore((s) => s.selectedServer?.members);
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickToBottom = useRef(true);

  const messages = chan?.messages ?? [];

  /** Erwähnbare Namen: Server-Mitglieder bzw. die zwei DM-Teilnehmer. */
  const knownUsernames = useMemo(() => {
    if (dm) return user ? [channel.name, user.username] : [channel.name];
    return members?.map((m) => m.username) ?? [];
  }, [dm, channel.name, members, user]);

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
    void loadHistory(channel.id);
  }, [channel.id, loadHistory]);

  // Kanalwechsel: Datei-Auswahl, Antwort-Bezug, Thread und Suche zurücksetzen.
  useEffect(() => {
    setFiles([]);
    setError(null);
    setReplyTo(null);
    setThreadRootId(null);
    setSearchOpen(false);
    setSearchQuery('');
  }, [channel.id]);

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
    if (!selected) return;
    setError(null);
    setFiles((prev) => {
      const next = [...prev, ...Array.from(selected)];
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

  function jumpTo(messageId: string) {
    // CSS.escape: Die ID stammt aus dem (absenderkontrollierten) replyTo –
    // ohne Escaping würde z. B. ein `"]` den Selektor-Parser werfen lassen.
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    if (!el) return; // Original (noch) nicht geladen – bewusst kein Auto-Nachladen in v1
    stickToBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    setFlashId(messageId);
    window.setTimeout(
      () => setFlashId((current) => (current === messageId ? null : current)),
      1500,
    );
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if ((!content && files.length === 0) || sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    stickToBottom.current = true;
    try {
      await sendMessage(channel.id, content, files, replyTo ?? undefined);
      setFiles([]);
      setReplyTo(null);
      // Erwähnungs-Push (Phase 12): dem Server melden, WEN wir erwähnt haben –
      // er pusht die offline Erwähnten. Erwähnungen stecken im E2EE-Text, der
      // Server kann sie nicht selbst erkennen. Nur in Server-Kanälen.
      if (!dm && members && user && content) {
        const mentioned = members
          .filter((m) => m.userId !== user.id && mentionsUser(content, m.username))
          .map((m) => m.userId);
        if (mentioned.length > 0) {
          void useAuthStore
            .getState()
            .authFetch<void>(`/api/channels/${channel.id}/notify-mentions`, {
              method: 'POST',
              body: { userIds: mentioned },
            })
            .catch(() => undefined);
        }
      }
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : 'Senden fehlgeschlagen',
      );
      setDraft(content); // Eingabe nicht verlieren
    } finally {
      setSending(false);
    }
  }

  const canSend =
    dm || hasPermission(permissionsFromString(myPermissions), Permissions.SendMessages);
  const canManageMessages =
    !dm && hasPermission(permissionsFromString(myPermissions), Permissions.ManageMessages);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-950/50 px-4 py-3 shadow">
        <span className="text-zinc-500">{dm ? '@' : '#'}</span>
        <span className="font-semibold">{channel.name}</span>
        <span
          className="ml-auto text-xs text-zinc-500"
          title="Nachrichten und Anhänge werden auf deinem Gerät ver- und entschlüsselt – der Server sieht nur Ciphertext."
        >
          🔒 Ende-zu-Ende-verschlüsselt
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
            className="w-44 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
          />
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
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="message-list"
      >
        {chan?.hasMore && !threadRootId && (
          <button
            type="button"
            onClick={() => void loadOlder(channel.id)}
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
              mentionsUser(content.text, user.username);
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
                knownUsernames={knownUsernames}
                reactionEvents={reactions[msg.id]}
                canSend={canSend}
                canManageMessages={canManageMessages}
                hasThread={childrenByParent.has(msg.id) || !!content?.replyTo}
                flash={flashId === msg.id}
                onToggleReaction={(emoji, mine) => toggleReaction(msg.id, emoji, mine)}
                onReply={() => startReply(msg.id)}
                onOpenThread={() => setThreadRootId(msg.id)}
                onJumpTo={jumpTo}
                onEdit={(newText) => handleEdit(msg.id, newText)}
                onDelete={() => handleDelete(msg.id)}
              />
            );
          })}
        </ul>
      </div>

      <form onSubmit={onSubmit} className="px-4 pb-4">
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
          <div className="flex items-center gap-2">
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
              className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none disabled:opacity-60"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                sending ? 'Wird gesendet …' : `Nachricht an ${dm ? '@' : '#'}${channel.name}`
              }
              disabled={sending}
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
      </form>
    </main>
  );
}
