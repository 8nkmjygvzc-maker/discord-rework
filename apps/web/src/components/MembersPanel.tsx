import { useServersStore } from '../store/servers';
import { usePresenceStore } from '../store/presence';

/** Rechte Spalte: Mitglieder des ausgewählten Servers mit Online-Status. */
export default function MembersPanel() {
  const server = useServersStore((s) => s.selectedServer);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  if (!server) return null;
  const onlineIds = new Set(onlineUsers.map((u) => u.id));

  // Online-Mitglieder zuerst, innerhalb der Gruppen alphabetisch.
  const members = [...server.members].sort((a, b) => {
    const aOnline = onlineIds.has(a.userId) ? 0 : 1;
    const bOnline = onlineIds.has(b.userId) ? 0 : 1;
    return aOnline - bOnline || a.username.localeCompare(b.username);
  });

  return (
    <aside className="w-60 shrink-0 overflow-y-auto bg-zinc-900 px-3 py-4">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Mitglieder – {server.members.length}
      </h2>
      <ul className="mt-2 space-y-0.5" data-testid="member-list">
        {members.map((member) => {
          const online = onlineIds.has(member.userId);
          return (
            <li
              key={member.userId}
              className={`flex items-center gap-2 rounded px-1 py-1.5 ${online ? '' : 'opacity-50'}`}
            >
              <div className="relative">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-sm font-bold text-white">
                  {member.username.slice(0, 1).toUpperCase()}
                </div>
                <span
                  className={`absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 ${
                    online ? 'bg-emerald-500' : 'bg-zinc-600'
                  }`}
                />
              </div>
              <span className="truncate text-sm text-zinc-300">
                {member.nickname ?? member.username}
              </span>
              {member.userId === server.ownerId && (
                <span title="Server-Eigentümer" className="ml-auto text-xs">
                  👑
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
