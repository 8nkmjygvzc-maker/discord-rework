import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useServersStore } from '../store/servers';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';
import ServerRail from '../components/ServerRail';
import ChannelSidebar from '../components/ChannelSidebar';
import MembersPanel from '../components/MembersPanel';
import ChatView from '../components/ChatView';
import VoiceStage from '../components/VoiceStage';
import HomeView from '../components/HomeView';
import RolesDialog from '../components/RolesDialog';
import InviteDialog from '../components/InviteDialog';
import Modal from '../components/Modal';
import { ApiError } from '../lib/api';
import { useAuthStore } from '../store/auth';
import type { InvitePreview } from '@parley/shared';

interface MainPageProps {
  onOpenProfile: () => void;
}

type DialogKind = 'createServer' | 'joinServer' | 'createChannel' | 'roles' | 'invite' | null;

/** Extrahiert den Code aus einem Einladungslink oder nimmt die Eingabe als Code. */
function extractInviteCode(input: string): string {
  const match = input.trim().match(/\/invite\/([A-Za-z0-9]+)/);
  return match ? match[1] : input.trim();
}

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
  const [channelType, setChannelType] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [home, setHome] = useState(false);
  // Deep-Link /invite/<code>: beim Laden den Beitritts-Dialog vorbefüllen.
  const [initialInvite, setInitialInvite] = useState<string | null>(null);

  useEffect(() => {
    const match = window.location.pathname.match(/^\/invite\/([A-Za-z0-9]+)/);
    if (match) {
      setInitialInvite(match[1]);
      setDialog('joinServer');
      window.history.replaceState(null, '', '/'); // URL säubern
    }
  }, []);

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
            onCreateChannel={(type) => {
              setChannelType(type);
              setDialog('createChannel');
            }}
            onOpenProfile={onOpenProfile}
            onOpenRoles={() => setDialog('roles')}
            onOpenInvite={() => setDialog('invite')}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <VoiceStage />
            {channel ? (
              <ChatView channel={channel} />
            ) : (
              <main className="flex flex-1 items-center justify-center text-zinc-500">
                Wähle einen Kanal
              </main>
            )}
          </div>

          <MembersPanel />
        </>
      )}

      {dialog === 'createServer' && (
        <CreateServerDialog onClose={() => setDialog(null)} onSuccess={() => setHome(false)} />
      )}
      {dialog === 'joinServer' && (
        <JoinServerDialog
          initialCode={initialInvite}
          onClose={() => {
            setDialog(null);
            setInitialInvite(null);
          }}
          onSuccess={() => setHome(false)}
        />
      )}
      {dialog === 'createChannel' && (
        <CreateChannelDialog type={channelType} onClose={() => setDialog(null)} />
      )}
      {dialog === 'roles' && <RolesDialog onClose={() => setDialog(null)} />}
      {dialog === 'invite' && server && (
        <InviteDialog serverId={server.id} onClose={() => setDialog(null)} />
      )}
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

function CreateServerDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
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

function JoinServerDialog({
  initialCode,
  onClose,
  onSuccess,
}: {
  initialCode: string | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const acceptInvite = useServersStore((s) => s.acceptInvite);
  const [value, setValue] = useState(initialCode ?? '');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const authFetch = useAuthStore.getState().authFetch;

  const loadPreview = useCallback(
    async (raw: string) => {
      const code = extractInviteCode(raw);
      if (!code) return;
      setError(null);
      setPreview(null);
      setPending(true);
      try {
        setPreview(await authFetch<InvitePreview>(`/api/invites/${code}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Einladung ungültig oder abgelaufen');
      } finally {
        setPending(false);
      }
    },
    [authFetch],
  );

  // Deep-Link: Vorschau sofort laden, wenn ein Code mitgegeben wurde.
  useEffect(() => {
    if (initialCode) void loadPreview(initialCode);
  }, [initialCode, loadPreview]);

  async function join() {
    if (!preview) return;
    setPending(true);
    setError(null);
    try {
      await acceptInvite(preview.code);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Beitritt fehlgeschlagen');
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="Server beitreten" onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-400">
        Füge einen Einladungslink oder -code ein, den dir jemand geteilt hat.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadPreview(value);
        }}
      >
        <div className="flex gap-2">
          <input
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Einladungslink oder Code"
          />
          <button
            type="submit"
            disabled={pending || value.trim().length < 1}
            className="shrink-0 rounded-lg border border-zinc-600 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
          >
            Prüfen
          </button>
        </div>
      </form>

      {error && (
        <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
          <p className="font-semibold text-zinc-100">{preview.serverName}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {preview.memberCount} Mitglied{preview.memberCount === 1 ? '' : 'er'} · eingeladen von{' '}
            {preview.inviterUsername}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => void join()}
            className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {pending
              ? 'Bitte warten …'
              : preview.alreadyMember
                ? 'Öffnen (bereits Mitglied)'
                : 'Beitreten'}
          </button>
        </div>
      )}
    </Modal>
  );
}

function CreateChannelDialog({ type, onClose }: { type: 'TEXT' | 'VOICE'; onClose: () => void }) {
  const createChannel = useServersStore((s) => s.createChannel);
  const isVoice = type === 'VOICE';
  return (
    <Modal title={isVoice ? 'Sprachkanal erstellen' : 'Textkanal erstellen'} onClose={onClose}>
      <DialogForm
        placeholder={isVoice ? 'Name des Sprachkanals' : 'Name des Textkanals'}
        submitLabel="Erstellen"
        onSubmit={(name) => createChannel(name, type)}
        onClose={onClose}
      />
    </Modal>
  );
}
