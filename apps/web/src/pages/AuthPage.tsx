import { FormEvent, useState } from 'react';
import { useAuthStore } from '../store/auth';
import { ApiError } from '../lib/api';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);

  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (mode === 'register') {
        await register(username.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server nicht erreichbar');
    } finally {
      setPending(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 ' +
    'placeholder-zinc-500 focus:border-indigo-500 focus:outline-none';

  return (
    // h-full + m-auto statt min-h-screen + items-center: html/body/#root sind
    // overflow:hidden (Phase 15) – zentriert per Auto-Margin bleibt Inhalt, der
    // höher als der Viewport ist, scrollbar statt oben abgeschnitten.
    <div className="auth-aurora flex h-full overflow-y-auto bg-zinc-900 p-4 text-zinc-100">
      <div className="animate-view-in m-auto w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-800/90 p-8 shadow-xl backdrop-blur">
        <h1 className="text-3xl font-bold tracking-tight">Parley</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === 'login' ? 'Willkommen zurück!' : 'Konto erstellen'}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1 text-sm font-medium">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-md px-3 py-1.5 transition ${
                mode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {mode === 'register' && (
            <label className="block text-sm text-zinc-300">
              Benutzername
              <input
                className={inputCls}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Dein Benutzername"
                autoComplete="username"
                required
              />
            </label>
          )}

          <label className="block text-sm text-zinc-300">
            E-Mail
            <input
              className={inputCls}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="du@example.com"
              autoComplete="email"
              required
            />
          </label>

          <label className="block text-sm text-zinc-300">
            Passwort
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'mindestens 8 Zeichen' : '••••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </label>

          {error && (
            <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'Bitte warten …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
        </form>
      </div>
    </div>
  );
}
