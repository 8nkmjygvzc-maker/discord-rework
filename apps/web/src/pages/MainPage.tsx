import { FormEvent, useEffect, useState } from 'react';
import { useServersStore } from '../store/servers';
import ServerRail from '../components/ServerRail';
import ChannelSidebar from '../components/ChannelSidebar';
import MembersPanel from '../components/MembersPanel';
import ChatView from '../components/ChatView';
import Modal from '../components/Modal';
import { ApiError } from '../lib/api';

interface MainPageProps {
  onOpenProfile: () => void;
}

type DialogKind = 'createServer' | 'joinServer' | 'createChannel' | null;

/** Hauptansicht nach dem Login: Server-Leiste, Kanäle, Inhalt, Mitglieder. */
export default function MainPage({ onOpenProfile }: MainPageProps) {
  const loaded = useServersStore((s) => s.loaded);
  const servers = useServersStore((s) => s.servers);
  const server = useServersStore((s) => s.selectedServer);
  const selectedChannelId = useServersStore((s) => s.selectedChannelId);
  const loadServers = useServersStore((s) => s.loadServers);

  const [dialog, setDialog] = useState<DialogKind>(null);

  // Initiales Laden (Gateway-READY lädt ebenfalls – hier zusätzlich, damit die
  // UI nicht auf den WebSocket warten muss).
  useEffect(() => {
    if (!loaded) void loadServers();
  }, [loaded, loadServers]);

  const channel = server?.channels.find((c) => c.id === selectedChannelId) ?? null;

  return (
    <div className="flex h-screen bg-zinc-800 text-zinc-100">
      <ServerRail
        onCreateServer={() => setDialog('createServer')}
        onJoinServer={() => setDialog('joinServer')}
      />

      {servers.length === 0 && loaded ? (
        <EmptyState
          onCreate={() => setDialog('createServer')}
          onJoin={() => setDialog('joinServer')}
        />
      ) : (
        <>
          <ChannelSidebar
            onCreateChannel={() => setDialog('createChannel')}
            onOpenProfile={onOpenProfile}
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

      {dialog === 'createServer' && <CreateServerDialog onClose={() => setDialog(null)} />}
      {dialog === 'joinServer' && <JoinServerDialog onClose={() => setDialog(null)} />}
      {dialog === 'createChannel' && <CreateChannelDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-zinc-400">
      <p className="text-lg">Du bist noch auf keinem Server.</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition hover:bg-indigo-500"
        >
          Server erstellen
        </button>
        <button
          type="button"
          onClick={onJoin}
          className="rounded-lg border border-zinc-600 px-4 py-2.5 font-semibold text-zinc-300 transition hover:bg-zinc-700"
        >
          Server beitreten
        </button>
      </div>
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

function CreateServerDialog({ onClose }: { onClose: () => void }) {
  const createServer = useServersStore((s) => s.createServer);
  return (
    <Modal title="Server erstellen" onClose={onClose}>
      <DialogForm
        placeholder="Name des Servers"
        submitLabel="Erstellen"
        onSubmit={createServer}
        onClose={onClose}
      />
    </Modal>
  );
}

function JoinServerDialog({ onClose }: { onClose: () => void }) {
  const joinServer = useServersStore((s) => s.joinServer);
  return (
    <Modal title="Server beitreten" onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-400">
        Füge die Server-ID ein, die dir jemand geteilt hat. (Einladungslinks kommen in Phase 12.)
      </p>
      <DialogForm
        placeholder="Server-ID"
        submitLabel="Beitreten"
        onSubmit={joinServer}
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
