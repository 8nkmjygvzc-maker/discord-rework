import { useState } from 'react';
import type { PresenceMode } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import Avatar from './Avatar';

interface UserFooterProps {
  onOpenProfile: () => void;
}

/** Auswählbare Anwesenheits-Modi mit Anzeige-Farbe und Erklärung. */
const PRESENCE_OPTIONS: {
  mode: PresenceMode;
  label: string;
  dotClass: string;
  hint: string;
}[] = [
  { mode: 'online', label: 'Online', dotClass: 'bg-emerald-500', hint: 'Für andere sichtbar' },
  {
    mode: 'dnd',
    label: 'Nicht stören',
    dotClass: 'bg-red-500',
    hint: 'Keine Desktop-Benachrichtigungen',
  },
  {
    mode: 'invisible',
    label: 'Offline',
    dotClass: 'bg-zinc-500',
    hint: 'Du erscheinst offline, kannst aber alles nutzen',
  },
];

/** Punkt-Farbe und Beschriftung des eigenen Status im Footer. */
function ownPresenceDisplay(mode: PresenceMode, connected: boolean): { dot: string; title: string } {
  if (!connected) return { dot: 'bg-zinc-600', title: 'Offline (nicht verbunden)' };
  switch (mode) {
    case 'dnd':
      return { dot: 'bg-red-500', title: 'Nicht stören' };
    case 'invisible':
      return { dot: 'bg-zinc-600', title: 'Offline (unsichtbar für andere)' };
    default:
      return { dot: 'animate-presence bg-emerald-500', title: 'Online' };
  }
}

/** Eigenes Nutzer-Panel am Fuß der Sidebar (Server- und Home-Ansicht). */
export default function UserFooter({ onOpenProfile }: UserFooterProps) {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const connected = usePresenceStore((s) => s.connected);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState(false);
  if (!user) return null;

  const presence = user.presence ?? 'online';
  const { dot, title } = ownPresenceDisplay(presence, connected);

  async function selectPresence(mode: PresenceMode) {
    setPickerOpen(false);
    if (mode === presence) return;
    setError(false);
    try {
      await updateProfile({ presence: mode });
    } catch {
      setError(true);
    }
  }

  return (
    <footer className="relative flex items-center gap-2 border-t border-zinc-950/50 bg-zinc-950/40 px-3 py-2">
      {/* Status-Auswahl: öffnet sich über dem Footer, schließt bei Klick daneben. */}
      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
          <div
            className="absolute bottom-full left-2 z-50 mb-2 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
            data-testid="presence-picker"
          >
            {PRESENCE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                onClick={() => void selectPresence(option.mode)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-zinc-800 ${
                  option.mode === presence ? 'bg-zinc-800/60' : ''
                }`}
              >
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${option.dotClass}`} />
                <span className="min-w-0">
                  <span className="block text-sm text-zinc-100">{option.label}</span>
                  <span className="block text-[11px] leading-tight text-zinc-500">
                    {option.hint}
                  </span>
                </span>
                {option.mode === presence && (
                  <span className="ml-auto text-xs text-zinc-400">✓</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <button
        type="button"
        title={`Status: ${title} – klicken zum Ändern`}
        data-testid="presence-toggle"
        onClick={() => setPickerOpen((o) => !o)}
        className="relative shrink-0 cursor-pointer rounded-full"
      >
        <Avatar
          name={user.username}
          avatarUrl={user.avatarUrl}
          sizeClass="h-8 w-8 text-sm"
          fallbackClass="bg-indigo-600"
        />
        <span
          className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${dot}`}
        />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-100">{user.username}</p>
        <p className="truncate text-xs text-zinc-500">
          {error ? 'Status konnte nicht geändert werden' : user.status || title}
        </p>
      </div>
      <button
        type="button"
        title="Profil öffnen"
        onClick={onOpenProfile}
        className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        ⚙
      </button>
    </footer>
  );
}
