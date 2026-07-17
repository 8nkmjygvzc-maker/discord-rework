import { useState } from 'react';
import { useAuthStore } from '../store/auth';
import { useDmsStore } from '../store/dms';
import { usePresenceStore } from '../store/presence';
import { useUiStore } from '../store/ui';
import { ApiError } from '../lib/api';
import { presenceDotClass, presenceLabel } from '../lib/presence';
import Avatar from './Avatar';

/**
 * Profilkarte (Discord-artig): öffnet sich global über useUiStore.openProfile
 * bei Klick auf Avatar/Namen. Zeigt Banner (oder Farbverlauf), Avatar,
 * Namen, Online-Status und Status-Text; bei fremden Profilen gibt es einen
 * „Nachricht senden“-Knopf (öffnet/erzeugt den DM-Kanal).
 */
export default function UserProfileCard({ onOpenDm }: { onOpenDm?: () => void }) {
  const user = useUiStore((s) => s.profileUser);
  const closeProfile = useUiStore((s) => s.closeProfile);
  const me = useAuthStore((s) => s.user);
  const presence = usePresenceStore((s) => {
    const entry = user ? s.onlineUsers.find((u) => u.id === user.id) : undefined;
    return entry ? (entry.presence ?? 'online') : 'offline';
  });
  const openDm = useDmsStore((s) => s.openDm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const isSelf = me?.id === user.id;

  async function message() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await openDm(user.id);
      closeProfile();
      onOpenDm?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'DM konnte nicht geöffnet werden');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={closeProfile}
      data-testid="profile-card"
    >
      <div
        className="animate-pop-in w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Banner: hochgeladenes Bild oder Farbverlauf als Platzhalter. */}
        {user.bannerUrl ? (
          <img src={user.bannerUrl} alt="" draggable={false} className="h-28 w-full object-cover" />
        ) : (
          <div className="h-28 w-full bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600" />
        )}

        <div className="px-5 pb-5">
          <div className="relative -mt-10 flex items-end justify-between">
            <span className="relative inline-block rounded-full border-4 border-zinc-800">
              <Avatar
                name={user.username}
                avatarUrl={user.avatarUrl}
                sizeClass="h-20 w-20 text-3xl"
                fallbackClass="bg-indigo-600"
              />
              <span
                title={presenceLabel(presence)}
                className={`absolute right-0.5 bottom-0.5 h-5 w-5 rounded-full border-4 border-zinc-800 ${presenceDotClass(presence)}`}
              />
            </span>
            <button
              type="button"
              onClick={closeProfile}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 rounded-xl bg-zinc-900 p-4">
            <p className="text-lg font-bold text-zinc-100">{user.nickname ?? user.username}</p>
            {user.nickname && user.nickname !== user.username && (
              <p className="text-sm text-zinc-400">@{user.username}</p>
            )}
            {user.status && (
              <p className="mt-2 border-t border-zinc-800 pt-2 text-sm break-words text-zinc-300">
                {user.status}
              </p>
            )}
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-400">
              {error}
            </p>
          )}

          {!isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void message()}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Öffne …' : '💬 Nachricht senden'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
