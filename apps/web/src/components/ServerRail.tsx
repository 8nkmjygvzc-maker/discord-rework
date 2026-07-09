import { useServersStore } from '../store/servers';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';

interface ServerRailProps {
  /** true = Home-Ansicht (DMs/Freunde) ist aktiv. */
  homeActive: boolean;
  onSelectHome: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
}

/** Linke Icon-Leiste: Home-Button, ein runder Button pro Server, Aktionen unten. */
export default function ServerRail({
  homeActive,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onJoinServer,
}: ServerRailProps) {
  const servers = useServersStore((s) => s.servers);
  const selectedId = useServersStore((s) => s.selectedServer?.id);
  const incomingCount = useFriendsStore((s) => s.list.incoming.length);
  // Ungelesene DMs (Phase 15) zählen mit auf den Zuhause-Badge.
  const unreadDmCount = useDmsStore((s) => Object.values(s.unread).reduce((sum, n) => sum + n, 0));
  const homeBadge = incomingCount + unreadDmCount;

  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto bg-zinc-950 py-3">
      <button
        type="button"
        title="Zuhause (Direktnachrichten & Freunde)"
        onClick={onSelectHome}
        className={`relative flex h-12 w-12 items-center justify-center text-lg font-bold text-white transition-all ${
          homeActive
            ? 'rounded-2xl bg-indigo-600'
            : 'rounded-3xl bg-zinc-800 hover:rounded-2xl hover:bg-indigo-500'
        }`}
        data-testid="home-button"
      >
        P
        {homeBadge > 0 && (
          <span
            title={`${incomingCount} offene Freundschaftsanfrage(n), ${unreadDmCount} ungelesene Direktnachricht(en)`}
            className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-zinc-950 bg-red-500 text-[10px] font-bold"
          >
            {homeBadge > 9 ? '9+' : homeBadge}
          </span>
        )}
      </button>

      <div className="my-1 h-px w-8 bg-zinc-800" />

      {servers.map((server) => {
        const active = !homeActive && server.id === selectedId;
        return (
          <button
            key={server.id}
            type="button"
            title={server.name}
            onClick={() => onSelectServer(server.id)}
            className={`flex h-12 w-12 items-center justify-center text-lg font-bold text-white transition-all ${
              active
                ? 'rounded-2xl bg-indigo-600'
                : 'rounded-3xl bg-zinc-800 hover:rounded-2xl hover:bg-indigo-500'
            }`}
          >
            {server.name.slice(0, 1).toUpperCase()}
          </button>
        );
      })}

      <div className="my-1 h-px w-8 bg-zinc-800" />

      <button
        type="button"
        title="Server erstellen"
        onClick={onCreateServer}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-zinc-800 text-2xl text-emerald-400 transition-all hover:rounded-2xl hover:bg-emerald-600 hover:text-white"
      >
        +
      </button>
      <button
        type="button"
        title="Server beitreten (per ID)"
        onClick={onJoinServer}
        className="flex h-12 w-12 items-center justify-center rounded-3xl bg-zinc-800 text-lg text-emerald-400 transition-all hover:rounded-2xl hover:bg-emerald-600 hover:text-white"
      >
        →
      </button>
    </nav>
  );
}
