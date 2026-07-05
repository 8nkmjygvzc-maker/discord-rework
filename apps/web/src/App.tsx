import { useEffect, useState } from 'react';
import type { HealthStatus } from '@parley/shared';

type ApiState = { kind: 'loading' } | { kind: 'ok'; health: HealthStatus } | { kind: 'error' };

export default function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' });

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthStatus>;
      })
      .then((health) => setApi({ kind: 'ok', health }))
      .catch(() => setApi({ kind: 'error' }));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-800 p-8 shadow-xl">
        <h1 className="text-3xl font-bold tracking-tight">Parley</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Phase 0 – Projektgerüst (Arbeitstitel, Branding folgt)
        </p>

        <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Backend-Status
          </h2>
          {api.kind === 'loading' && <p className="mt-2 text-zinc-300">Prüfe Verbindung …</p>}
          {api.kind === 'ok' && (
            <p className="mt-2 text-emerald-400">
              ✓ API erreichbar ({api.health.service}, {api.health.timestamp})
            </p>
          )}
          {api.kind === 'error' && (
            <p className="mt-2 text-red-400">
              ✗ API nicht erreichbar – läuft das Backend auf Port 3001?
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
