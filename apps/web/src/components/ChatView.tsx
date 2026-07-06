import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChannelInfo, hasPermission, Permissions, permissionsFromString } from '@parley/shared';
import { useMessagesStore } from '../store/messages';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { ApiError } from '../lib/api';

interface ChatViewProps {
  channel: ChannelInfo;
}

/** Nachrichtenliste + Eingabezeile für den ausgewählten Textkanal. */
export default function ChatView({ channel }: ChatViewProps) {
  const user = useAuthStore((s) => s.user);
  const myPermissions = useServersStore((s) => s.selectedServer?.myPermissions ?? '0');
  const chan = useMessagesStore((s) => s.byChannel[channel.id]);
  const decrypted = useMessagesStore((s) => s.decrypted);
  const loadHistory = useMessagesStore((s) => s.loadHistory);
  const loadOlder = useMessagesStore((s) => s.loadOlder);
  const sendMessage = useMessagesStore((s) => s.sendMessage);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const messages = chan?.messages ?? [];

  useEffect(() => {
    void loadHistory(channel.id);
  }, [channel.id, loadHistory]);

  // Auto-Scroll ans Ende, solange der Nutzer nicht bewusst hochgescrollt hat.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft('');
    setError(null);
    stickToBottom.current = true;
    try {
      await sendMessage(channel.id, content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      setDraft(content); // Eingabe nicht verlieren
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-950/50 px-4 py-3 shadow">
        <span className="text-zinc-500">#</span>
        <span className="font-semibold">{channel.name}</span>
        <span
          className="ml-auto text-xs text-zinc-500"
          title="Nachrichten werden auf deinem Gerät ver- und entschlüsselt – der Server sieht nur Ciphertext."
        >
          🔒 Ende-zu-Ende-verschlüsselt
        </span>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
        data-testid="message-list"
      >
        {chan?.hasMore && (
          <button
            type="button"
            onClick={() => void loadOlder(channel.id)}
            className="mx-auto mb-3 block rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700/50"
          >
            Ältere Nachrichten laden
          </button>
        )}
        {chan?.loaded && messages.length === 0 && (
          <p className="mt-8 text-center text-sm text-zinc-500">
            Noch keine Nachrichten in #{channel.name} – schreib die erste!
          </p>
        )}
        <ul className="space-y-3">
          {messages.map((msg, i) => {
            const prev = messages[i - 1];
            // Aufeinanderfolgende Nachrichten desselben Absenders gruppieren.
            const grouped = prev?.senderId === msg.senderId;
            return (
              <li key={msg.id} className={`flex gap-3 ${grouped ? '-mt-2' : ''}`}>
                <div className="w-9 shrink-0">
                  {!grouped && (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-700 font-bold text-white">
                      {msg.senderUsername.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <p className="text-sm">
                      <span
                        className={`font-semibold ${
                          msg.senderId === user?.id ? 'text-indigo-400' : 'text-zinc-200'
                        }`}
                      >
                        {msg.senderUsername}
                      </span>
                      <span className="ml-2 text-xs text-zinc-500">
                        {new Date(msg.createdAt).toLocaleString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </p>
                  )}
                  {decrypted[msg.id] !== undefined ? (
                    <p className="text-sm break-words whitespace-pre-wrap text-zinc-300">
                      {decrypted[msg.id]}
                    </p>
                  ) : (
                    <p
                      className="text-sm text-zinc-500 italic"
                      title="Der Schlüssel für diese Nachricht liegt (noch) nicht vor – z. B. weil sie vor deinem Beitritt gesendet wurde."
                    >
                      🔒 Nachricht kann nicht entschlüsselt werden
                    </p>
                  )}
                </div>
              </li>
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
        {/* Die UI blendet nur aus – blockiert wird serverseitig (403). */}
        {hasPermission(permissionsFromString(myPermissions), Permissions.SendMessages) ? (
          <input
            className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Nachricht an #${channel.name}`}
            maxLength={4000}
          />
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
