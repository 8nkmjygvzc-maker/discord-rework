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
  hasThread: boolean;
  /** Kurzes Aufleuchten nach „zum Original springen“. */
  flash: boolean;
  onToggleReaction: (emoji: string, mine: boolean) => void;
  onReply: () => void;
  onOpenThread: () => void;
  onJumpTo: (messageId: string) => void;
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
  hasThread,
  flash,
  onToggleReaction,
  onReply,
  onOpenThread,
  onJumpTo,
}: MessageRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

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
            {content.text && (
              <MentionText
                text={content.text}
                knownUsernames={knownUsernames}
                myUsername={myUsername}
              />
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
                onClick={() => onToggleReaction(group.emoji, group.mine)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  group.mine
                    ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                    : 'border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:border-zinc-500'
                }`}
              >
                <span>{group.emoji}</span>
                <span>{group.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover-Aktionen: reagieren, antworten, Thread anzeigen */}
      {content !== undefined && (
        <div className="absolute -top-3 right-2 hidden items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900 px-1 py-0.5 shadow group-hover:flex">
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
}: {
  text: string;
  knownUsernames: string[];
  myUsername: string | null;
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
    </p>
  );
}
