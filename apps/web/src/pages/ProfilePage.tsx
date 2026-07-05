import { FormEvent, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import { ApiError } from '../lib/api';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const connected = usePresenceStore((s) => s.connected);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  const [status, setStatus] = useState(user?.status ?? '');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  if (!user) return null;

  const memberSince = new Date(user.createdAt).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setPending(true);
    try {
      await updateProfile({ status });
      setFeedback({ kind: 'ok', text: 'Profil gespeichert' });
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Server nicht erreichbar',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-800 p-8 shadow-xl">
        <div className="flex items-center gap-4">
          {/* Platzhalter-Avatar: Initiale auf Farbfläche; Uploads kommen in Phase 8 */}
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600 text-2xl font-bold">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{user.username}</h1>
            <p className="text-sm text-zinc-400">{user.email}</p>
          </div>
        </div>

        {/* Live-Presence aus dem Gateway (Phase 2): wer ist gerade online? */}
        <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-300">Gerade online</h2>
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${
                connected ? 'text-emerald-400' : 'text-zinc-500'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-zinc-600'}`}
              />
              {connected ? 'Live verbunden' : 'Verbinde …'}
            </span>
          </div>
          <ul className="mt-3 space-y-1.5" data-testid="online-list">
            {onlineUsers.map((u) => (
              <li key={u.id} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span>{u.username}</span>
                {u.id === user.id && <span className="text-xs text-zinc-500">(du)</span>}
              </li>
            ))}
            {connected && onlineUsers.length === 0 && (
              <li className="text-sm text-zinc-500">Niemand online</li>
            )}
          </ul>
        </div>

        <dl className="mt-6 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-400">Mitglied seit</dt>
            <dd>{memberSince}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-zinc-400">Nutzer-ID</dt>
            <dd className="font-mono text-xs text-zinc-500">{user.id}</dd>
          </div>
        </dl>

        <form onSubmit={onSave} className="mt-6">
          <label className="block text-sm text-zinc-300">
            Status
            <input
              className="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="Was machst du gerade?"
              maxLength={128}
            />
          </label>

          {feedback && (
            <p
              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                feedback.kind === 'ok'
                  ? 'border-emerald-900 bg-emerald-950/50 text-emerald-400'
                  : 'border-red-900 bg-red-950/50 text-red-400'
              }`}
            >
              {feedback.text}
            </p>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? 'Speichere …' : 'Speichern'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-zinc-600 px-4 py-2.5 font-semibold text-zinc-300 transition hover:bg-zinc-700"
            >
              Abmelden
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
