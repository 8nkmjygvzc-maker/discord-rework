import { ReactNode, useState } from 'react';
import type { ChannelInfo } from '@parley/shared';
import { useDmsStore } from '../store/dms';
import { useFriendsStore } from '../store/friends';
import { useServersStore } from '../store/servers';
import { usePresenceStore } from '../store/presence';
import { useUiStore } from '../store/ui';
import { useVoiceStore } from '../store/voice';
import { presenceDotClass, presenceLabel, presenceMap } from '../lib/presence';
import Avatar from './Avatar';
import ChatView from './ChatView';
import FriendsPanel from './FriendsPanel';
import UserFooter from './UserFooter';
import VoicePanel from './VoicePanel';
import VoiceStage from './VoiceStage';
import WelcomeView from './WelcomeView';

interface HomeViewProps {
  onOpenProfile: () => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
  /** Server-Leiste für den Handy-Drawer (kommt aus MainPage). */
  mobileRail?: ReactNode;
}

/** Home-Ansicht (Phase 7): DM-Liste links, Freunde-Panel oder DM-Chat rechts. */
export default function HomeView({
  onOpenProfile,
  onCreateServer,
  onJoinServer,
  mobileRail,
}: HomeViewProps) {
  const channels = useDmsStore((s) => s.channels);
  const selectedDmId = useDmsStore((s) => s.selectedDmId);
  const selectDm = useDmsStore((s) => s.selectDm);
  const unread = useDmsStore((s) => s.unread);
  const onlineUsers = usePresenceStore((s) => s.onlineUsers);
  const dmCalls = useVoiceStore((s) => s.dmCalls);

  // Onboarding (Phase 15): frisches Konto = alle drei Stores geladen und leer
  // (auch Anfragen/Blockierte zählen – wer schon interagiert hat, ist nicht frisch).
  const dmsLoaded = useDmsStore((s) => s.loaded);
  const friends = useFriendsStore((s) => s.list);
  const friendsLoaded = useFriendsStore((s) => s.loaded);
  const serversLoaded = useServersStore((s) => s.loaded);
  const serverCount = useServersStore((s) => s.servers.length);
  const [welcomeSkipped, setWelcomeSkipped] = useState(false);
  const freshAccount =
    dmsLoaded &&
    friendsLoaded &&
    serversLoaded &&
    channels.length === 0 &&
    serverCount === 0 &&
    friends.friends.length === 0 &&
    friends.incoming.length === 0 &&
    friends.outgoing.length === 0 &&
    friends.blocked.length === 0;
  const showWelcome = freshAccount && !welcomeSkipped;

  const presenceById = presenceMap(onlineUsers);
  const selected = channels.find((c) => c.id === selectedDmId) ?? null;

  // Handy-Drawer (Verbesserungs-Runde): wie in MainPage für die Server-Ansicht.
  const navOpen = useUiStore((s) => s.navOpen);
  const closeNav = useUiStore((s) => s.closeNav);

  return (
    <>
      <div
        className={`flex shrink-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl max-md:transition-transform max-md:duration-200 ${
          navOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
        }`}
      >
        {mobileRail}
        <aside className="flex h-full w-60 shrink-0 flex-col bg-zinc-900">
          <header className="border-b border-zinc-950/50 px-4 py-3 shadow">
            <h1 className="font-bold text-zinc-100">Zuhause</h1>
          </header>

          <div className="flex-1 overflow-y-auto px-2 py-3">
            <button
              type="button"
              onClick={() => {
                selectDm(null);
                closeNav();
              }}
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
                    onClick={() => {
                      selectDm(dm.id);
                      closeNav();
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                      dm.id === selectedDmId
                        ? 'bg-zinc-700/60 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    <span className="relative shrink-0">
                      <Avatar
                        name={dm.otherUser.username}
                        avatarUrl={dm.otherUser.avatarUrl}
                        sizeClass="h-7 w-7 text-xs"
                      />
                      <span
                        title={presenceLabel(presenceById.get(dm.otherUser.id))}
                        className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-zinc-900 ${presenceDotClass(presenceById.get(dm.otherUser.id))}`}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{dm.otherUser.username}</span>
                      {dm.otherUser.status && (
                        <span
                          className="block truncate text-[11px] text-zinc-500"
                          title={dm.otherUser.status}
                        >
                          {dm.otherUser.status}
                        </span>
                      )}
                    </span>
                    {(dmCalls[dm.id]?.length ?? 0) > 0 && (
                      <span title="Anruf aktiv" className="text-emerald-400" aria-hidden>
                        📞
                      </span>
                    )}
                    {(unread[dm.id] ?? 0) > 0 && (
                      <span
                        title={`${unread[dm.id]} ungelesene Nachricht(en)`}
                        data-testid="dm-unread-badge"
                        className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
                      >
                        {unread[dm.id] > 9 ? '9+' : unread[dm.id]}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <VoicePanel />
          <UserFooter onOpenProfile={onOpenProfile} />
        </aside>
      </div>
      {navOpen && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={closeNav} />}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Video-Bühne privater Anrufe (Kamera/Screen-Share) – wie im Server-Layout. */}
        <VoiceStage />
        {selected ? (
          <ChatView channel={toDmChannelInfo(selected.id, selected.otherUser.username)} dm />
        ) : showWelcome ? (
          <WelcomeView
            onAddFriends={() => setWelcomeSkipped(true)}
            onCreateServer={onCreateServer}
            onJoinServer={onJoinServer}
            onSkip={() => setWelcomeSkipped(true)}
          />
        ) : (
          <FriendsPanel />
        )}
      </div>
    </>
  );
}

/** ChatView erwartet ein ChannelInfo – für DMs synthetisieren wir eins. */
function toDmChannelInfo(id: string, otherUsername: string): ChannelInfo {
  return { id, serverId: null, type: 'DM', name: otherUsername, position: 0, isPrivate: false };
}
