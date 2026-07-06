import { hasPermission, Permissions, permissionsFromString } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import UserFooter from './UserFooter';

interface ChannelSidebarProps {
  onCreateChannel: () => void;
  onOpenProfile: () => void;
  onOpenRoles: () => void;
}

/** Mittlere Spalte: Server-Kopf, Kanalliste, eigenes Nutzer-Panel unten. */
export default function ChannelSidebar({
  onCreateChannel,
  onOpenProfile,
  onOpenRoles,
}: ChannelSidebarProps) {
  const user = useAuthStore((s) => s.user);
  const server = useServersStore((s) => s.selectedServer);
  const selectedChannelId = useServersStore((s) => s.selectedChannelId);
  const selectChannel = useServersStore((s) => s.selectChannel);
  const deleteChannel = useServersStore((s) => s.deleteChannel);
  const leaveServer = useServersStore((s) => s.leaveServer);
  const deleteServer = useServersStore((s) => s.deleteServer);

  if (!user) return null;
  const isOwner = server?.ownerId === user.id;
  const myPerms = server ? permissionsFromString(server.myPermissions) : 0n;
  const canManageChannels = hasPermission(myPerms, Permissions.ManageChannels);
  const canManageRoles = hasPermission(myPerms, Permissions.ManageRoles);

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-zinc-900">
      {/* Server-Kopf */}
      <header className="flex items-center justify-between border-b border-zinc-950/50 px-4 py-3 shadow">
        <h1 className="truncate font-bold text-zinc-100">{server?.name ?? 'Kein Server'}</h1>
        {server && (
          <button
            type="button"
            title="Server-ID kopieren (zum Einladen teilen)"
            onClick={() => void navigator.clipboard.writeText(server.id)}
            className="ml-auto rounded p-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            ID
          </button>
        )}
        {server && canManageRoles && (
          <button
            type="button"
            title="Rollen verwalten"
            onClick={onOpenRoles}
            className="rounded p-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Rollen
          </button>
        )}
        {server &&
          (isOwner ? (
            <button
              type="button"
              title="Server löschen"
              onClick={() => {
                if (window.confirm(`Server „${server.name}“ endgültig löschen?`)) {
                  void deleteServer(server.id);
                }
              }}
              className="rounded p-1 text-xs text-zinc-500 hover:bg-red-950 hover:text-red-400"
            >
              Löschen
            </button>
          ) : (
            <button
              type="button"
              title="Server verlassen"
              onClick={() => void leaveServer(server.id)}
              className="rounded p-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Verlassen
            </button>
          ))}
      </header>

      {/* Kanalliste */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {server && (
          <>
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Textkanäle
              </span>
              {canManageChannels && (
                <button
                  type="button"
                  title="Kanal erstellen"
                  onClick={onCreateChannel}
                  className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  +
                </button>
              )}
            </div>
            <ul className="space-y-0.5">
              {server.channels.map((channel) => (
                <li key={channel.id} className="group">
                  <button
                    type="button"
                    onClick={() => selectChannel(channel.id)}
                    className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
                      channel.id === selectedChannelId
                        ? 'bg-zinc-700/60 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <span className="text-zinc-500">#</span>
                    <span className="truncate">{channel.name}</span>
                    {canManageChannels && server.channels.length > 1 && (
                      <span
                        role="button"
                        title="Kanal löschen"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteChannel(channel.id);
                        }}
                        className="ml-auto hidden rounded px-1 text-zinc-500 group-hover:inline hover:text-red-400"
                      >
                        ✕
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <UserFooter onOpenProfile={onOpenProfile} />
    </aside>
  );
}
