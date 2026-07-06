import { FormEvent, useEffect, useState } from 'react';
import { useServersStore } from '../store/servers';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';
import ServerRail from '../components/ServerRail';
import ChannelSidebar from '../components/ChannelSidebar';
import MembersPanel from '../components/MembersPanel';
import ChatView from '../components/ChatView';
import HomeView from '../components/HomeView';
import RolesDialog from '../components/RolesDialog';
import Modal from '../components/Modal';
import { ApiError } from '../lib/api';

interface MainPageProps {
  onOpenProfile: () => void;
}

type DialogKind = 'createServer' | 'joinServer' | 'createChannel' | 'roles' | null;

/** Hauptansicht nach dem Login: Server-Leiste + Home (DMs/Freunde) ODER Server. */
export default function MainPage({ onOpenProfile }: MainPageProps) {
  const loaded = useServersStore((s) => s.loaded);
  const servers = useServersStore((s) => s.servers);
  const server = useServersStore((s) => s.selectedServer);
  const selectedChannelId = useServersStore((s) => s.selectedChannelId);
  const loadServers = useServersStore((s) => s.loadServers);
  const selectServer = useServersStore((s) => s.selectServer);
  const friendsLoaded = useFriendsStore((s) => s.loaded);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const dmsLoaded = useDmsStore((s) => s.loaded);
  const loadDms = useDmsStore((s) => s.loadDms);

  const [dialog, setDialog] = useState<DialogKind>(null);
  const [home, setHome] = useState(false);

  // Initiales Laden (Gateway-READY lädt ebenfalls – hier zusätzlich, damit die
  // UI nicht auf den WebSocket warten muss).
  useEffect(() => {
    if (!loaded) void loadServers();
    if (!friendsLoaded) void loadFriends();
    if (!dmsLoaded) void loadDms();
  }, [loaded, loadServers, friendsLoaded, loadFriends, dmsLoaded, loadDms]);

  const channel = server?.channels.find((c) => c.id === selectedChannelId) ?? null;
  // Ohne Server ist Home die sinnvollere Ansicht (statt leerem Zustand).
  const showHome = home || (loaded && servers.length === 0);

  return (
    <div className="flex h-screen bg-zinc-800 text-zinc-100">
      <ServerRail
        homeActive={showHome}
        onSelectHome={() => setHome(true)}
        onSelectServer={(serverId) => {
          setHome(false);
          void selectServer(serverId);
        }}
        onCreateServer={() => setDialog('createServer')}
        onJoinServer={() => setDialog('joinServer')}
      />

      {showHome ? (
        <HomeView onOpenProfile={onOpenProfile} />
      ) : (
        <>
          <ChannelSidebar
            onCreateChannel={() => setDialog('createChannel')}
            onOpenProfile={onOpenProfile}
            onOpenRoles={() => setDialog('roles')}
          />

          {channel ? (
            <ChatView channel={channel} />
          ) : (
            <main className="flex min-w-0 flex-1 items-center justify-center text-zinc-500">
              Wähle einen Kanal
            </main>
          )}

          <MembersPanel />
        </>
      )}

      {dialog === 'createServer' && (
        <CreateServerDialog onClose={() => setDialog(null)} onSuccess={() => setHome(false)} />
      )}
      {dialog === 'joinServer' && (
        <JoinServerDialog onClose={() => setDialog(null)} onSuccess={() => setHome(false)} />
      )}
      {dialog === 'createChannel' && <CreateChannelDialog onClose={() => setDialog(null)} />}
      {dialog === 'roles' && <RolesDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Gemeinsames Formular-Gerüst der drei Dialoge. */
function DialogForm({
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Server nicht erreichbar');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        autoFocus
        className="w-full rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
      />
      {error && (
        <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || value.trim().length < 2}
        className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Bitte warten …' : submitLabel}
      </button>
    </form>
  );
}

function CreateServerDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const createServer = useServersStore((s) => s.createServer);
  return (
    <Modal title="Server erstellen" onClose={onClose}>
      <DialogForm
        placeholder="Name des Servers"
        submitLabel="Erstellen"
        onSubmit={async (name) => {
          await createServer(name);
          onSuccess(); // aus der Home-Ansicht direkt zum neuen Server wechseln
        }}
        onClose={onClose}
      />
    </Modal>
  );
}

function JoinServerDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const joinServer = useServersStore((s) => s.joinServer);
  return (
    <Modal title="Server beitreten" onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-400">
        Füge die Server-ID ein, die dir jemand geteilt hat. (Einladungslinks kommen in Phase 12.)
      </p>
      <DialogForm
        placeholder="Server-ID"
        submitLabel="Beitreten"
        onSubmit={async (serverId) => {
          await joinServer(serverId);
          onSuccess();
        }}
        onClose={onClose}
      />
    </Modal>
  );
}

function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const createChannel = useServersStore((s) => s.createChannel);
  return (
    <Modal title="Kanal erstellen" onClose={onClose}>
      <DialogForm
        placeholder="Name des Kanals"
        submitLabel="Erstellen"
        onSubmit={createChannel}
        onClose={onClose}
      />
    </Modal>
  );
}
