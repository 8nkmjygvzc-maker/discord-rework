import { useMemo, useState } from 'react';
import type { DecodedMessageContent, MessageInfo } from '@parley/shared';
import type { ReactionEventState } from '../store/messages';
import { splitMentions } from '../lib/mentions';
import AttachmentView from './AttachmentView';

/** Schnellauswahl fürs Reaktions-Popover – bewusst klein für v1. */
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '✅', '👎'];

interface ReactionGroup {
  emoji: string;
  count: number;
  /** Habe ICH mit diesem Emoji reagiert? (steuert Toggle + Hervorhebung) */
  mine: boolean;
  usernames: string[];
}

interface MessageRowProps {
  message: MessageInfo;
  /** undefined = (noch) nicht entschlüsselbar → 🔒-Platzhalter. */
  content: DecodedMessageContent | undefined;
  grouped: boolean;
  isOwn: boolean;
  mentionsMe: boolean;
  myUserId: string | null;
  /** Benutzernamen des Kanals – nur bekannte Namen werden als Erwähnung markiert. */
  knownUsernames: string[];
  myUsername: string | null;
  /** Rohe Reaktions-Events auf diese Nachricht (Aggregation passiert hier). */
  reactionEvents: Record<string, ReactionEventState> | undefined;
  /**
   * Reaktionen/Antworten sind technisch Nachrichten – ohne Schreibrecht
   * blendet die UI die Aktionen aus (blockiert wird ohnehin serverseitig).
   */
  canSend: boolean;
  /** Darf fremde Nachrichten löschen (ManageMessages, Phase 13). */
  canManageMessages: boolean;
  hasThread: boolean;
  /** Kurzes Aufleuchten nach „zum Original springen“. */
  flash: boolean;
  onToggleReaction: (emoji: string, mine: boolean) => void;
  onReply: () => void;
  onOpenThread: () => void;
  onJumpTo: (messageId: string) => void;
  /** Bearbeitet den Text (nur eigene Nachrichten); wirft bei Fehler. */
  onEdit: (newText: string) => Promise<void>;
  onDelete: () => void;
}

/** Eine Nachricht im Verlauf: Zitat, Text (mit Erwähnungen), Anhänge, Reaktionen. */
export default function MessageRow({
  message,
  content,
  grouped,
  isOwn,
  mentionsMe,
  myUserId,
  knownUsernames,
  myUsername,
  reactionEvents,
  canSend,
  canManageMessages,
  hasThread,
  flash,
  onToggleReaction,
  onReply,
  onOpenThread,
  onJumpTo,
  onEdit,
  onDelete,
}: MessageRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Nur eigene, entschlüsselte Textnachrichten (keine Reaktions-Events) lassen
  // sich bearbeiten; löschen darf der Autor oder jemand mit ManageMessages.
  const isTextMessage = content !== undefined && !content.reaction;
  const canEdit = isOwn && isTextMessage;
  const canDelete = isTextMessage && (isOwn || canManageMessages);

  function startEdit() {
    setEditDraft(content?.text ?? '');
    setEditing(true);
  }

  async function saveEdit() {
    const next = editDraft.trim();
    if (editBusy) return;
    // Leerer Text nur erlaubt, wenn Anhänge bleiben.
    if (!next && (content?.attachments.length ?? 0) === 0) return;
    if (next === (content?.text ?? '')) {
      setEditing(false);
      return;
    }
    setEditBusy(true);
    try {
      await onEdit(next);
      setEditing(false);
    } catch {
      // Fehler wird in der ChatView angezeigt – Bearbeitung offen lassen.
    } finally {
      setEditBusy(false);
    }
  }

  // add/remove-Events pro (Nutzer, Emoji) sind schon gefaltet (Store) –
  // hier bleibt nur: 'add'-Stände pro Emoji zählen.
  const reactionGroups = useMemo<ReactionGroup[]>(() => {
    const groups = new Map<string, ReactionGroup>();
    for (const [key, state] of Object.entries(reactionEvents ?? {})) {
      if (state.action !== 'add') continue;
      const separator = key.indexOf('|');
      const userId = key.slice(0, separator);
      const emoji = key.slice(separator + 1);
      const group = groups.get(emoji) ?? { emoji, count: 0, mine: false, usernames: [] };
      group.count += 1;
      group.usernames.push(state.username);
      if (userId === myUserId) group.mine = true;
      groups.set(emoji, group);
    }
    return [...groups.values()];
  }, [reactionEvents, myUserId]);

  return (
    <li
      data-message-id={message.id}
      className={`group relative flex gap-3 rounded px-1 transition-colors ${grouped ? '-mt-2' : ''} ${
        flash
          ? 'bg-indigo-500/20'
          : mentionsMe
            ? 'border-l-2 border-yellow-500 bg-yellow-500/10'
            : ''
      }`}
    >
      <div className="w-9 shrink-0">
        {!grouped && (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 font-bold text-white">
            {message.senderUsername.slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="text-sm">
            <span className={`font-semibold ${isOwn ? 'text-indigo-400' : 'text-zinc-200'}`}>
              {message.senderUsername}
            </span>
            <span className="ml-2 text-xs text-zinc-500">
              {new Date(message.createdAt).toLocaleString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </p>
        )}

        {content !== undefined ? (
          <>
            {content.replyTo && (
              <button
                type="button"
                title="Zum Original springen (falls geladen)"
                onClick={() => onJumpTo(content.replyTo!.messageId)}
                className="mb-0.5 flex max-w-full items-center gap-1.5 truncate border-l-2 border-zinc-600 pl-2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <span aria-hidden>↩</span>
                <span className="font-semibold">@{content.replyTo.senderUsername}</span>
                <span className="truncate">{content.replyTo.preview || '📎 Anhang'}</span>
              </button>
            )}
            {editing ? (
              <div className="mt-0.5" data-testid="edit-box">
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    }
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  rows={2}
                  className="w-full resize-none rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:border-indigo-500 focus:outline-none"
                />
                <div className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
                  <span>Enter speichert · Esc bricht ab</span>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="ml-auto hover:text-zinc-300"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveEdit()}
                    disabled={editBusy}
                    className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            ) : (
              (content.text || message.editedAt) && (
                <MentionText
                  text={content.text}
                  knownUsernames={knownUsernames}
                  myUsername={myUsername}
                  edited={!!message.editedAt}
                />
              )
            )}
            {content.attachments.map((meta) => (
              <AttachmentView key={meta.id} meta={meta} />
            ))}
          </>
        ) : (
          <p
            className="text-sm text-zinc-500 italic"
            title="Der Schlüssel für diese Nachricht liegt (noch) nicht vor – z. B. weil sie vor deinem Beitritt gesendet wurde."
          >
            🔒 Nachricht kann nicht entschlüsselt werden
          </p>
        )}

        {reactionGroups.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1" data-testid="reactions">
            {reactionGroups.map((group) => (
              <button
                key={group.emoji}
                type="button"
                title={group.usernames.join(', ')}
                disabled={!canSend}
                onClick={() => onToggleReaction(group.emoji, group.mine)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  group.mine
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                    : 'border-zinc-700 bg-zinc-800/80 text-zinc-300'
                } ${canSend ? (group.mine ? '' : 'hover:border-zinc-500') : 'cursor-default'}`}
              >
                <span>{group.emoji}</span>
                <span>{group.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover-Aktionen: reagieren, antworten, bearbeiten, löschen, Thread */}
      {content !== undefined && !editing && (canSend || hasThread || canEdit || canDelete) && (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 px-1 py-0.5 shadow group-hover:flex">
          {canSend && (
            <>
              <button
                type="button"
                title="Reagieren"
                onClick={() => setPickerOpen((open) => !open)}
                className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700"
              >
                😊
              </button>
              <button
                type="button"
                title="Antworten"
                onClick={onReply}
                className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700"
              >
                ↩
              </button>
            </>
          )}
          {hasThread && (
            <button
              type="button"
              title="Thread anzeigen"
              onClick={onOpenThread}
              className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700"
            >
              🧵
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              title="Bearbeiten"
              data-testid="edit-message"
              onClick={startEdit}
              className="rounded px-1.5 py-0.5 text-sm hover:bg-zinc-700"
            >
              ✏️
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              title="Löschen"
              data-testid="delete-message"
              onClick={onDelete}
              className="rounded px-1.5 py-0.5 text-sm hover:bg-red-900/60"
            >
              🗑️
            </button>
          )}
        </div>
      )}
      {pickerOpen && (
        <div
          className="absolute -top-12 right-2 z-10 flex gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-1.5 shadow-lg"
          data-testid="emoji-picker"
        >
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                setPickerOpen(false);
                const mine = reactionGroups.some((g) => g.emoji === emoji && g.mine);
                onToggleReaction(emoji, mine);
              }}
              className="rounded px-1.5 py-0.5 text-lg hover:bg-zinc-700"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/** Text mit hervorgehobenen @Erwähnungen (nur bekannte Benutzernamen). */
function MentionText({
  text,
  knownUsernames,
  myUsername,
  edited,
}: {
  text: string;
  knownUsernames: string[];
  myUsername: string | null;
  /** Zeigt einen dezenten „(bearbeitet)“-Hinweis (Phase 13). */
  edited?: boolean;
}) {
  const segments = useMemo(() => splitMentions(text, knownUsernames), [text, knownUsernames]);
  return (
    <p className="text-sm break-words whitespace-pre-wrap text-zinc-300">
      {segments.map((segment, i) =>
        segment.mention ? (
          <span
            key={i}
            className={`rounded px-0.5 font-medium ${
              myUsername && segment.mention.toLowerCase() === myUsername.toLowerCase()
                ? 'bg-yellow-500/30 text-yellow-200'
                : 'bg-indigo-500/20 text-indigo-300'
            }`}
          >
            {segment.text}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
      {edited && (
        <span className="ml-1 text-[10px] text-zinc-500" title="Diese Nachricht wurde bearbeitet">
          (bearbeitet)
        </span>
      )}
    </p>
  );
}
