import { useServersStore } from '../store/servers';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';

interface MobileServerRailProps {
  homeActive: boolean;
  onSelectHome: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
}

/**
 * Server-Leiste für kleine Bildschirme (Verbesserungs-Runde): Das Hover-Dock
 * (ServerDock) funktioniert ohne Maus nicht – auf dem Handy sitzt die Leiste
 * deshalb wie bei Discord als schmale Spalte im Navigations-Drawer.
 * Nur unter dem md-Breakpoint sichtbar.
 */
export default function MobileServerRail({
  homeActive,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onJoinServer,
}: MobileServerRailProps) {
  const servers = useServersStore((s) => s.servers);
  const selectedId = useServersStore((s) => s.selectedServer?.id);
  const incomingCount = useFriendsStore((s) => s.list.incoming.length);
  const unreadDmCount = useDmsStore((s) => Object.values(s.unread).reduce((sum, n) => sum + n, 0));
  const homeBadge = incomingCount + unreadDmCount;

  const circle =
    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold text-white transition';

  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-zinc-950/60 bg-zinc-950/90 py-3 md:hidden">
      <button
        type="button"
        title="Freunde & Direktnachrichten"
        onClick={onSelectHome}
        className={`relative ${circle} ${homeActive ? 'bg-indigo-600' : 'bg-zinc-700'}`}
        data-testid="mobile-home-button"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden>
          <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-6 2.02-6 4.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5c0-2.48-2.69-4.5-6-4.5Zm7.5-2a3.5 3.5 0 1 0-2.63-5.8 5.98 5.98 0 0 1 .4 4.99c.63.5 1.4.81 2.23.81Zm.5 2c-.55 0-1.08.07-1.58.2 1.28 1.02 2.08 2.4 2.08 4.3V19h3a1 1 0 0 0 1-1v-.5c0-2.48-2.02-4.5-4.5-4.5Z" />
        </svg>
        {homeBadge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-zinc-950 bg-red-500 px-0.5 text-[9px] font-bold">
            {homeBadge > 9 ? '9+' : homeBadge}
          </span>
        )}
      </button>

      <div className="h-px w-8 shrink-0 bg-zinc-700/60" />

      {servers.map((server) => (
        <button
          key={server.id}
          type="button"
          title={server.name}
          onClick={() => onSelectServer(server.id)}
          className={`${circle} overflow-hidden ${
            !homeActive && server.id === selectedId ? 'bg-indigo-600' : 'bg-zinc-700'
          }`}
        >
          {server.iconUrl ? (
            <img src={server.iconUrl} alt={server.name} className="h-full w-full object-cover" />
          ) : (
            server.name.slice(0, 1).toUpperCase()
          )}
        </button>
      ))}

      <button
        type="button"
        title="Server erstellen"
        onClick={onCreateServer}
        className={`${circle} bg-zinc-800 text-xl text-emerald-400`}
      >
        +
      </button>
      <button
        type="button"
        title="Server beitreten (mit Einladung)"
        onClick={onJoinServer}
        className={`${circle} bg-zinc-800 text-emerald-400`}
      >
        →
      </button>
    </div>
  );
}
