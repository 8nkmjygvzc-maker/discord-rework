import { useMemo, useState } from 'react';
import { MAX_EMBEDS_PER_MESSAGE } from '@parley/shared';
import type { DecodedMessageContent, LinkEmbed, MessageInfo } from '@parley/shared';
import type { ReactionEventState } from '../store/messages';
import { MentionTargets, splitMentions } from '../lib/mentions';
import { splitLinks } from '../lib/links';
import {
  MediaEmbed,
  detectMediaEmbed,
  mediaEmbedKey,
  spotifyPlayerHeight,
  spotifyPlayerUrl,
  youtubePlayerUrl,
  youtubeThumbnailUrl,
} from '../lib/mediaEmbeds';
import AttachmentView from './AttachmentView';
import Avatar from './Avatar';

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
  /** Bekannte Nutzer-/Rollennamen des Kanals – nur die werden markiert. */
  mentionTargets: MentionTargets;
  /** Meine Rollennamen (für die gelbe Hervorhebung von Rollen-Erwähnungen). */
  myRoleNames: string[];
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
  /** Rollenfarbe des Absenders (höchste Rolle mit Farbe, Phase 15). */
  senderColor: string | null;
  /** Profilbild des Absenders (Phase 15) – null = Initialen-Platzhalter. */
  senderAvatarUrl: string | null;
  /** Klick auf Avatar/Name → Profilkarte des Absenders. */
  onShowProfile: () => void;
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
  mentionTargets,
  myRoleNames,
  myUsername,
  reactionEvents,
  canSend,
  canManageMessages,
  hasThread,
  flash,
  senderColor,
  senderAvatarUrl,
  onShowProfile,
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
      className={`group animate-msg-in relative flex gap-3 rounded px-1 transition-colors ${grouped ? '-mt-2' : ''} ${
        flash
          ? 'bg-indigo-500/20'
          : mentionsMe
            ? 'border-l-2 border-yellow-500 bg-yellow-500/10'
            : ''
      }`}
    >
      <div className="w-9 shrink-0">
        {!grouped && (
          <button
            type="button"
            title={`Profil von ${message.senderUsername} ansehen`}
            onClick={onShowProfile}
            className="cursor-pointer rounded-full transition hover:brightness-110"
          >
            <Avatar name={message.senderUsername} avatarUrl={senderAvatarUrl} sizeClass="h-9 w-9" />
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <p className="text-sm">
            <button
              type="button"
              title={`Profil von ${message.senderUsername} ansehen`}
              onClick={onShowProfile}
              className={`cursor-pointer font-semibold hover:underline ${isOwn ? 'text-indigo-400' : 'text-zinc-200'}`}
              style={senderColor ? { color: senderColor } : undefined}
            >
              {message.senderUsername}
            </button>
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
                  targets={mentionTargets}
                  myRoleNames={myRoleNames}
                  myUsername={myUsername}
                  edited={!!message.editedAt}
                />
              )
            )}
            <EmbedList text={content.text} embeds={content.embeds} />
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

/** Text mit hervorgehobenen @Erwähnungen (Nutzer, Rollen, @everyone). */
function MentionText({
  text,
  targets,
  myRoleNames,
  myUsername,
  edited,
}: {
  text: string;
  targets: MentionTargets;
  myRoleNames: string[];
  myUsername: string | null;
  /** Zeigt einen dezenten „(bearbeitet)“-Hinweis (Phase 13). */
  edited?: boolean;
}) {
  const segments = useMemo(() => splitMentions(text, targets), [text, targets]);
  const myRoles = useMemo(() => new Set(myRoleNames.map((r) => r.toLowerCase())), [myRoleNames]);
  return (
    <p className="text-sm break-words whitespace-pre-wrap text-zinc-300">
      {segments.map((segment, i) => {
        if (!segment.mention) return <LinkifiedText key={i} text={segment.text} />;
        const { kind, name } = segment.mention;
        // Gelb, wenn die Erwähnung MICH trifft (direkt, eigene Rolle, alle).
        const hitsMe =
          kind === 'everyone' ||
          (kind === 'user' && !!myUsername && name.toLowerCase() === myUsername.toLowerCase()) ||
          (kind === 'role' && myRoles.has(name.toLowerCase()));
        return (
          <span
            key={i}
            className={`rounded px-0.5 font-medium ${
              hitsMe ? 'bg-yellow-500/30 text-yellow-200' : 'bg-indigo-500/20 text-indigo-300'
            }`}
          >
            {segment.text}
          </span>
        );
      })}
      {edited && (
        <span className="ml-1 text-[10px] text-zinc-500" title="Diese Nachricht wurde bearbeitet">
          (bearbeitet)
        </span>
      )}
    </p>
  );
}

/**
 * Alle Vorschau-Karten einer Nachricht. YouTube-/Spotify-Links bekommen einen
 * abspielbaren Player (à la Discord) statt der generischen Karte – erkannt wird
 * beim LESER direkt aus den URLs (Text + Unfurl-Embeds), damit das auch dann
 * funktioniert, wenn der Unfurl beim Absender keine Metadaten liefern konnte.
 */
function EmbedList({ text, embeds }: { text: string; embeds: LinkEmbed[] }) {
  const { media, generic } = useMemo(() => {
    const seen = new Set<string>();
    const media: { key: string; item: MediaEmbed; meta: LinkEmbed | null }[] = [];
    const generic: LinkEmbed[] = [];
    // Unfurl-Embeds zuerst (liefern Titel/Beschreibung), dann Text-Links –
    // so erscheinen Player auch ohne erfolgreichen Unfurl.
    const candidates: { url: string; meta: LinkEmbed | null }[] = [
      ...embeds.map((e) => ({ url: e.url, meta: e })),
      ...splitLinks(text)
        .filter((s) => s.href)
        .map((s) => ({ url: s.href!, meta: null })),
    ];
    for (const { url, meta } of candidates) {
      const item = detectMediaEmbed(url);
      if (!item) {
        if (meta) generic.push(meta);
        continue;
      }
      const key = mediaEmbedKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      if (media.length < MAX_EMBEDS_PER_MESSAGE) media.push({ key, item, meta });
    }
    return { media, generic };
  }, [text, embeds]);

  return (
    <>
      {media.map(({ key, item, meta }) =>
        item.provider === 'youtube' ? (
          <YoutubeCard key={key} media={item} meta={meta} />
        ) : (
          <SpotifyCard key={key} media={item} />
        ),
      )}
      {generic.map((embed, i) => (
        <EmbedCard key={i} embed={embed} />
      ))}
    </>
  );
}

/**
 * YouTube-Vorschau: Thumbnail (deterministisch aus der Video-ID, kein Unfurl
 * nötig) mit Play-Button; erst der Klick lädt den eingebetteten Player –
 * so gibt es keinen automatischen Kontakt des Lesers zu YouTube-Playern.
 */
function YoutubeCard({
  media,
  meta,
}: {
  media: Extract<MediaEmbed, { provider: 'youtube' }>;
  meta: LinkEmbed | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [thumbOk, setThumbOk] = useState(true);
  const watchUrl = meta?.url ?? `https://www.youtube.com/watch?v=${media.videoId}`;
  return (
    <div className="mt-1 max-w-md overflow-hidden rounded border-l-4 border-red-600 bg-zinc-800/60 p-3">
      <p className="text-xs text-zinc-400">{meta?.siteName ?? 'YouTube'}</p>
      {meta?.title && (
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block font-semibold break-words text-indigo-300 hover:underline"
        >
          {meta.title}
        </a>
      )}
      <div className="mt-2 aspect-video w-full overflow-hidden rounded bg-black">
        {playing ? (
          <iframe
            src={youtubePlayerUrl(media)}
            title={meta?.title ?? 'YouTube-Video'}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
            className="h-full w-full border-0"
          />
        ) : (
          <button
            type="button"
            title="Video hier abspielen"
            onClick={() => setPlaying(true)}
            className="group/play relative block h-full w-full cursor-pointer"
            data-testid="youtube-play"
          >
            {thumbOk && (
              <img
                src={youtubeThumbnailUrl(media.videoId)}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setThumbOk(false)}
                className="h-full w-full object-cover"
              />
            )}
            {/* Play-Badge im YouTube-Stil, zentriert über dem Thumbnail */}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-12 w-16 items-center justify-center rounded-xl bg-black/70 text-2xl text-white transition group-hover/play:bg-red-600">
                ▶
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Spotify-Vorschau: der offizielle Embed-Player direkt in der Nachricht
 * (wie bei Discord). `loading="lazy"` lädt ihn erst, wenn er sichtbar wird.
 */
function SpotifyCard({ media }: { media: Extract<MediaEmbed, { provider: 'spotify' }> }) {
  return (
    <iframe
      src={spotifyPlayerUrl(media)}
      title="Spotify-Player"
      height={spotifyPlayerHeight(media.kind)}
      loading="lazy"
      allow="encrypted-media; picture-in-picture"
      referrerPolicy="no-referrer"
      className="mt-1 w-full max-w-md rounded-xl border-0"
      data-testid="spotify-player"
    />
  );
}

/**
 * Link-Vorschau-Karte (Embed, Feinschliff). Die Felder sind absenderkontrolliert,
 * aber beim Dekodieren schon defensiv geprüft (`url`/`imageUrl` sind http(s),
 * Texte geklemmt). Das Bild lädt der LESER-Browser direkt vom fremden Host –
 * `referrerPolicy="no-referrer"` reduziert die mitgesendeten Metadaten (der
 * IP-Leak selbst bleibt, siehe ROADMAP). Bricht der Bildabruf, wird es versteckt.
 */
function EmbedCard({ embed }: { embed: LinkEmbed }) {
  const [imageOk, setImageOk] = useState(true);
  return (
    <a
      href={embed.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 block max-w-md overflow-hidden rounded border-l-4 border-indigo-500 bg-zinc-800/60 p-3 no-underline transition hover:bg-zinc-800"
    >
      {embed.siteName && <p className="text-xs text-zinc-400">{embed.siteName}</p>}
      {embed.title && (
        <p className="mt-0.5 font-semibold break-words text-indigo-300">{embed.title}</p>
      )}
      {embed.description && (
        <p className="mt-1 text-sm break-words text-zinc-300">{embed.description}</p>
      )}
      {embed.imageUrl && imageOk && (
        <img
          src={embed.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageOk(false)}
          className="mt-2 max-h-72 w-full rounded object-cover"
        />
      )}
    </a>
  );
}

/** Nicht-Erwähnungs-Text mit klickbaren http(s)-Links (Feinschliff). */
function LinkifiedText({ text }: { text: string }) {
  const segments = useMemo(() => splitLinks(text), [text]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.href ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-indigo-400 underline decoration-indigo-400/40 underline-offset-2 hover:text-indigo-300"
          >
            {segment.text}
          </a>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
