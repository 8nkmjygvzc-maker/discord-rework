import { FormEvent, useEffect, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import { ApiError } from '../lib/api';
import { disablePush, enablePush, pushStatus, type PushStatus } from '../lib/push';

interface ProfilePageProps {
  /** Zurück zur Hauptansicht (gesetzt, sobald es eine gibt – ab Phase 3). */
  onBack?: () => void;
}

export default function ProfilePage({ onBack }: ProfilePageProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const connected = usePresenceStore((s) => s.connected);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  const [status, setStatus] = useState(user?.status ?? '');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    void pushStatus().then(setPush);
  }, []);

  async function togglePush() {
    setPushBusy(true);
    try {
      setPush(push === 'enabled' ? await disablePush() : await enablePush());
    } finally {
      setPushBusy(false);
    }
  }

  // Beim Abmelden die Push-Subscription lösen, damit dieses Gerät keine
  // Benachrichtigungen für den abgemeldeten Account mehr erhält.
  async function onLogout() {
    await disablePush().catch(() => undefined);
    await logout();
  }

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
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mb-4 text-sm text-zinc-400 transition hover:text-zinc-200"
          >
            ← Zurück
          </button>
        )}
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

        {/* Web-Push-Benachrichtigungen (Phase 12) */}
        <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-300">Benachrichtigungen</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {push === 'unsupported'
                  ? 'Von diesem Browser nicht unterstützt.'
                  : push === 'denied'
                    ? 'Im Browser blockiert – in den Website-Einstellungen erlauben.'
                    : push === 'enabled'
                      ? 'Aktiv – du wirst auch bei geschlossenem Tab benachrichtigt.'
                      : 'Push für DMs & Erwähnungen, auch bei geschlossenem Tab.'}
              </p>
            </div>
            <button
              type="button"
              disabled={pushBusy || push === 'unsupported' || push === 'denied' || push === null}
              onClick={() => void togglePush()}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                push === 'enabled'
                  ? 'bg-red-950/60 text-red-300 hover:bg-red-950'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500'
              }`}
            >
              {pushBusy ? '…' : push === 'enabled' ? 'Deaktivieren' : 'Aktivieren'}
            </button>
          </div>
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
              onClick={() => void onLogout()}
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
