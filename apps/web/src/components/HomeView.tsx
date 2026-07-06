import type { ChannelInfo } from '@parley/shared';
import { useDmsStore } from '../store/dms';
import { usePresenceStore } from '../store/presence';
import ChatView from './ChatView';
import FriendsPanel from './FriendsPanel';
import UserFooter from './UserFooter';

interface HomeViewProps {
  onOpenProfile: () => void;
}

/** Home-Ansicht (Phase 7): DM-Liste links, Freunde-Panel oder DM-Chat rechts. */
export default function HomeView({ onOpenProfile }: HomeViewProps) {
  const channels = useDmsStore((s) => s.channels);
  const selectedDmId = useDmsStore((s) => s.selectedDmId);
  const selectDm = useDmsStore((s) => s.selectDm);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);

  const onlineIds = new Set(onlineUsers.map((u) => u.id));
  const selected = channels.find((c) => c.id === selectedDmId) ?? null;

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col bg-zinc-900">
        <header className="border-b border-zinc-950/50 px-4 py-3 shadow">
          <h1 className="font-bold text-zinc-100">Zuhause</h1>
        </header>

        <div className="flex-1 overflow-y-auto px-2 py-3">
          <button
            type="button"
            onClick={() => selectDm(null)}
            className={`mb-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
              selectedDmId === null
                ? 'bg-zinc-700/60 text-zinc-100'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <span>👥</span>
            <span>Freunde</span>
          </button>

          <div className="px-2 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
            Direktnachrichten
          </div>
          {channels.length === 0 && (
            <p className="px-2 py-1 text-xs text-zinc-600">
              Noch keine – öffne eine über „Freunde“.
            </p>
          )}
          <ul className="space-y-0.5">
            {channels.map((dm) => (
              <li key={dm.id}>
                <button
                  type="button"
                  onClick={() => selectDm(dm.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                    dm.id === selectedDmId
                      ? 'bg-zinc-700/60 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <span className="relative">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-700 text-xs font-bold text-white">
                      {dm.otherUser.username.slice(0, 1).toUpperCase()}
                    </span>
                    <span
                      className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 ${
                        onlineIds.has(dm.otherUser.id) ? 'bg-emerald-500' : 'bg-zinc-600'
                      }`}
                    />
                  </span>
                  <span className="truncate">{dm.otherUser.username}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <UserFooter onOpenProfile={onOpenProfile} />
      </aside>

      {selected ? <ChatView channel={toDmChannelInfo(selected.id, selected.otherUser.username)} dm /> : <FriendsPanel />}
    </>
  );
}

/** ChatView erwartet ein ChannelInfo – für DMs synthetisieren wir eins. */
function toDmChannelInfo(id: string, otherUsername: string): ChannelInfo {
  return { id, serverId: null, type: 'DM', name: otherUsername, position: 0, isPrivate: false };
}
