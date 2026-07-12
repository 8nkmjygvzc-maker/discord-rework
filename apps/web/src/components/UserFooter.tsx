import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import Avatar from './Avatar';

interface UserFooterProps {
  onOpenProfile: () => void;
}

/** Eigenes Nutzer-Panel am Fuß der Sidebar (Server- und Home-Ansicht). */
export default function UserFooter({ onOpenProfile }: UserFooterProps) {
  const user = useAuthStore((s) => s.user);
  const connected = usePresenceStore((s) => s.connected);
  if (!user) return null;

  return (
    <footer className="flex items-center gap-2 border-t border-zinc-950/50 bg-zinc-950/40 px-3 py-2">
      <div className="relative">
        <Avatar
          name={user.username}
          avatarUrl={user.avatarUrl}
          sizeClass="h-8 w-8 text-sm"
          fallbackClass="bg-indigo-600"
        />
        <span
          title={connected ? 'Online' : 'Offline'}
          className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-950 ${
            connected ? 'animate-presence bg-emerald-500' : 'bg-zinc-600'
          }`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-100">{user.username}</p>
        <p className="truncate text-xs text-zinc-500">{user.status || ' '}</p>
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
