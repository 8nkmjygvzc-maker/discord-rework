import {
  ChannelInfo,
  hasPermission,
  Permissions,
  permissionsFromString,
  VoiceState,
} from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { useVoiceStore } from '../store/voice';
import { useNoticesStore } from '../store/notices';
import { ApiError } from '../lib/api';
import UserFooter from './UserFooter';
import VoicePanel from './VoicePanel';

/** Server-/Kanal-Aktion mit Fehler-Hinweis statt unbehandelter Rejection. */
function runAction(what: string, action: Promise<void>): void {
  action.catch((err: unknown) => {
    useNoticesStore
      .getState()
      .pushNotice(
        'Aktion fehlgeschlagen',
        err instanceof ApiError ? `${what}: ${err.message}` : `${what} – Server nicht erreichbar.`,
      );
  });
}

interface ChannelSidebarProps {
  onCreateChannel: (type: 'TEXT' | 'VOICE') => void;
  onOpenProfile: () => void;
  onOpenRoles: () => void;
  onOpenInvite: () => void;
}

/** Mittlere Spalte: Server-Kopf, Text-/Sprachkanäle, Voice-Panel, Nutzer-Panel. */
export default function ChannelSidebar({
  onCreateChannel,
  onOpenProfile,
  onOpenRoles,
  onOpenInvite,
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
  const canInvite = hasPermission(myPerms, Permissions.CreateInvite);

  const textChannels = server?.channels.filter((c) => c.type === 'TEXT') ?? [];
  const voiceChannels = server?.channels.filter((c) => c.type === 'VOICE') ?? [];
  const canDelete = canManageChannels && (server?.channels.length ?? 0) > 1;

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-zinc-900">
      {/* Server-Kopf */}
      <header className="flex items-center justify-between border-b border-zinc-950/50 px-4 py-3 shadow">
        <h1 className="truncate font-bold text-zinc-100">{server?.name ?? 'Kein Server'}</h1>
        {server && canInvite && (
          <button
            type="button"
            title="Zum Server einladen"
            onClick={onOpenInvite}
            className="ml-auto rounded p-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            Einladen
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
                  runAction('Server löschen', deleteServer(server.id));
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
              onClick={() => runAction('Server verlassen', leaveServer(server.id))}
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
            <SectionHeader
              label="Textkanäle"
              addTitle="Textkanal erstellen"
              canAdd={canManageChannels}
              onAdd={() => onCreateChannel('TEXT')}
            />
            <ul className="mb-4 space-y-0.5">
              {textChannels.length === 0 && (
                <li className="px-2 py-1 text-xs text-zinc-600">Noch keine Textkanäle</li>
              )}
              {textChannels.map((channel) => (
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
                    {canDelete && (
                      <DeleteX
                        onClick={() => runAction('Kanal löschen', deleteChannel(channel.id))}
                      />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <SectionHeader
              label="Sprachkanäle"
              addTitle="Sprachkanal erstellen"
              canAdd={canManageChannels}
              onAdd={() => onCreateChannel('VOICE')}
            />
            <ul className="space-y-0.5">
              {voiceChannels.map((channel) => (
                <VoiceChannelRow key={channel.id} channel={channel} canDelete={canDelete} />
              ))}
              {voiceChannels.length === 0 && (
                <li className="px-2 py-1 text-xs text-zinc-600">Noch keine Sprachkanäle</li>
              )}
            </ul>
          </>
        )}
      </div>

      <VoicePanel />
      <UserFooter onOpenProfile={onOpenProfile} />
    </aside>
  );
}

function SectionHeader({
  label,
  addTitle,
  canAdd,
  onAdd,
}: {
  label: string;
  addTitle: string;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-1">
      <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
      {canAdd && (
        <button
          type="button"
          title={addTitle}
          onClick={onAdd}
          className="rounded px-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          +
        </button>
      )}
    </div>
  );
}

function DeleteX({ onClick }: { onClick: () => void }) {
  return (
    <span
      role="button"
      title="Kanal löschen"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="ml-auto hidden rounded px-1 text-zinc-500 group-hover:inline hover:text-red-400"
    >
      ✕
    </span>
  );
}

/** Eine Sprachkanal-Zeile inkl. Teilnehmerliste darunter. */
function VoiceChannelRow({ channel, canDelete }: { channel: ChannelInfo; canDelete: boolean }) {
  const user = useAuthStore((s) => s.user);
  const deleteChannel = useServersStore((s) => s.deleteChannel);
  const activeChannelId = useVoiceStore((s) => s.activeChannelId);
  const status = useVoiceStore((s) => s.status);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const voiceStates = useVoiceStore((s) => s.voiceStates);
  const selfMuted = useVoiceStore((s) => s.selfMuted);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const selfCameraOn = useVoiceStore((s) => s.selfCameraOn);
  const selfScreenOn = useVoiceStore((s) => s.selfScreenOn);

  const participants = voiceStates.filter((v) => v.channelId === channel.id);
  const isActive = activeChannelId === channel.id;
  const connecting = isActive && status === 'connecting';

  return (
    <li className="group">
      <button
        type="button"
        onClick={() => void joinVoice(channel)}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm ${
          isActive ? 'text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
      >
        <span className="text-zinc-500">🔊</span>
        <span className="truncate">{channel.name}</span>
        {connecting && <span className="text-xs text-amber-400">…</span>}
        {canDelete && (
          <DeleteX onClick={() => runAction('Kanal löschen', deleteChannel(channel.id))} />
        )}
      </button>

      {participants.length > 0 && (
        <ul className="mt-0.5 mb-1 ml-6 space-y-0.5">
          {participants.map((p) => (
            <VoiceParticipant
              key={p.userId}
              state={p}
              isSelf={p.userId === user?.id}
              selfMuted={selfMuted}
              selfDeafened={selfDeafened}
              selfCameraOn={selfCameraOn}
              selfScreenOn={selfScreenOn}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function VoiceParticipant({
  state,
  isSelf,
  selfMuted,
  selfDeafened,
  selfCameraOn,
  selfScreenOn,
}: {
  state: VoiceState;
  isSelf: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  selfCameraOn: boolean;
  selfScreenOn: boolean;
}) {
  // Für sich selbst den lokalen (sofortigen) Zustand zeigen, sonst den Roster-Stand.
  const muted = isSelf ? selfMuted : state.muted;
  const deafened = isSelf ? selfDeafened : state.deafened;
  const cameraOn = isSelf ? selfCameraOn : state.cameraOn;
  const screenOn = isSelf ? selfScreenOn : state.screenOn;
  // Sprech-Erkennung (Phase 15): grüner Ring um den Avatar, solange der Nutzer spricht.
  const speaking = useVoiceStore((s) => s.speaking[state.userId] === true);
  return (
    <li className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-zinc-400">
      <span
        title={speaking ? 'Spricht' : undefined}
        className={`flex h-5 w-5 items-center justify-center rounded-full bg-emerald-700/70 text-[10px] font-bold text-white ${
          speaking ? 'ring-2 ring-emerald-400' : ''
        }`}
      >
        {state.username.slice(0, 1).toUpperCase()}
      </span>
      <span className={`truncate ${speaking ? 'text-zinc-100' : ''}`}>{state.username}</span>
      <span className="ml-auto flex items-center gap-0.5">
        {screenOn && <span title="Teilt den Bildschirm">🖥️</span>}
        {cameraOn && <span title="Kamera an">📹</span>}
        {deafened && <span title="Ton aus">🔕</span>}
        {muted && !deafened && <span title="Stumm">🔇</span>}
      </span>
    </li>
  );
}
