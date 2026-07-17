import { ChannelInfo, VoiceState } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { useServersStore } from '../store/servers';
import { useVoiceStore } from '../store/voice';
import Avatar from './Avatar';
import VoiceStage from './VoiceStage';

/**
 * Großansicht eines Sprachkanals im Hauptbereich (statt des Textchats).
 * Öffnet sich per Klick auf einen Sprachkanal in der Sidebar und zeigt alle
 * aktuell verbundenen Teilnehmer als Kacheln – inkl. Sprech-Ring und
 * Mute/Deafen/Kamera/Screen-Status. Läuft Video im Kanal, erscheint darüber
 * die Video-Bühne (VoiceStage). Unten eine Steuerleiste: Beitreten bzw.
 * Mute/Deafen/Kamera/Bildschirm/Trennen, wenn man selbst verbunden ist.
 */
export default function VoiceChannelView({ channel }: { channel: ChannelInfo }) {
  const user = useAuthStore((s) => s.user);
  const voiceStates = useVoiceStore((s) => s.voiceStates);
  const activeChannelId = useVoiceStore((s) => s.activeChannelId);
  const status = useVoiceStore((s) => s.status);
  const joinVoice = useVoiceStore((s) => s.joinVoice);

  const participants = voiceStates.filter((v) => v.channelId === channel.id);
  const isActive = activeChannelId === channel.id;
  const connecting = isActive && status === 'connecting';
  const connected = isActive && status === 'connected';

  // Kachelraster grob an die Teilnehmerzahl anpassen (1 → 1, 2–4 → 2, ab 5 → 3).
  const cols = participants.length <= 1 ? 1 : participants.length <= 4 ? 2 : 3;

  return (
    <main className="animate-view-in flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-zinc-950/50 px-4 py-3 shadow">
        <span className="text-zinc-500">🔊</span>
        <h2 className="truncate font-semibold text-zinc-100">{channel.name}</h2>
        <span className="text-xs text-zinc-500">
          {participants.length === 0 ? 'Niemand verbunden' : `${participants.length} verbunden`}
        </span>
      </header>

      {/* Video-Bühne nur für den Kanal, mit dem wir wirklich verbunden sind. */}
      {isActive && <VoiceStage />}

      <div className="chat-scrollbar flex-1 overflow-y-auto bg-zinc-950/30 p-4">
        {participants.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
            <span className="text-5xl">🔊</span>
            <p className="text-sm">Hier ist gerade niemand – sei die erste Person im Kanal!</p>
          </div>
        ) : (
          <div
            className="grid content-start gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {participants.map((p) => (
              <ParticipantTile key={p.userId} state={p} isSelf={p.userId === user?.id} />
            ))}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-center gap-2 border-t border-zinc-950/50 bg-zinc-900/60 px-4 py-3">
        {connected ? (
          <ConnectedControls />
        ) : (
          <button
            type="button"
            disabled={connecting}
            onClick={() => void joinVoice(channel)}
            className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? 'Verbinde …' : 'Sprachkanal beitreten'}
          </button>
        )}
      </footer>
    </main>
  );
}

/** Eine Teilnehmer-Kachel: großer Avatar, Name und Statussymbole. */
function ParticipantTile({ state, isSelf }: { state: VoiceState; isSelf: boolean }) {
  // Für sich selbst den lokalen (sofortigen) Zustand zeigen, sonst den Roster-Stand.
  const selfMuted = useVoiceStore((s) => s.selfMuted);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const selfCameraOn = useVoiceStore((s) => s.selfCameraOn);
  const selfScreenOn = useVoiceStore((s) => s.selfScreenOn);
  const speaking = useVoiceStore((s) => s.speaking[state.userId] === true);
  const avatarUrl = useServersStore(
    (s) => s.selectedServer?.members.find((m) => m.userId === state.userId)?.avatarUrl ?? null,
  );

  const muted = isSelf ? selfMuted : state.muted;
  const deafened = isSelf ? selfDeafened : state.deafened;
  const cameraOn = isSelf ? selfCameraOn : state.cameraOn;
  const screenOn = isSelf ? selfScreenOn : state.screenOn;

  return (
    <div
      className={`relative flex aspect-video flex-col items-center justify-center rounded-lg bg-zinc-900 ${
        speaking ? 'ring-2 ring-emerald-400' : 'ring-1 ring-zinc-800'
      }`}
    >
      <Avatar
        name={state.username}
        avatarUrl={avatarUrl}
        sizeClass="h-16 w-16 text-xl"
        fallbackClass="bg-emerald-700/70"
        className={speaking ? 'ring-2 ring-emerald-400' : ''}
      />
      <span className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-zinc-100">
        <span className="truncate">
          {state.username}
          {isSelf ? ' (Du)' : ''}
        </span>
        {screenOn && <span title="Teilt den Bildschirm">🖥️</span>}
        {cameraOn && <span title="Kamera an">📹</span>}
        {deafened && <span title="Ton aus">🔕</span>}
        {muted && !deafened && <span title="Stumm">🔇</span>}
      </span>
    </div>
  );
}

/** Steuerleiste, wenn man selbst mit diesem Kanal verbunden ist. */
function ConnectedControls() {
  const selfMuted = useVoiceStore((s) => s.selfMuted);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const selfCameraOn = useVoiceStore((s) => s.selfCameraOn);
  const selfScreenOn = useVoiceStore((s) => s.selfScreenOn);
  const hasMic = useVoiceStore((s) => s.hasMic);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);

  const base =
    'rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60';
  const off = 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700';
  const alert = 'bg-red-950/60 text-red-300 hover:bg-red-950';
  const on = 'bg-emerald-800/70 text-emerald-200 hover:bg-emerald-800';

  return (
    <>
      <button
        type="button"
        disabled={!hasMic}
        title={hasMic ? (selfMuted ? 'Stummschaltung aufheben' : 'Stummschalten') : 'Kein Mikrofon'}
        onClick={toggleMute}
        className={`${base} ${selfMuted || !hasMic ? alert : off}`}
      >
        {!hasMic ? '🚫' : selfMuted ? '🔇' : '🎤'}
      </button>
      <button
        type="button"
        title={selfDeafened ? 'Ton wieder anschalten' : 'Ton aus (Deafen)'}
        onClick={toggleDeafen}
        className={`${base} ${selfDeafened ? alert : off}`}
      >
        {selfDeafened ? '🔕' : '🎧'}
      </button>
      <button
        type="button"
        title={selfCameraOn ? 'Kamera ausschalten' : 'Kamera einschalten'}
        onClick={() => void toggleCamera()}
        className={`${base} ${selfCameraOn ? on : off}`}
      >
        {selfCameraOn ? '📹' : '📷'}
      </button>
      <button
        type="button"
        title={selfScreenOn ? 'Freigabe beenden' : 'Bildschirm teilen'}
        onClick={() => void toggleScreenShare()}
        className={`${base} ${selfScreenOn ? on : off}`}
      >
        🖥️
      </button>
      <button
        type="button"
        title="Verbindung trennen"
        onClick={() => void leaveVoice()}
        className={`${base} bg-red-900/70 text-red-200 hover:bg-red-900`}
      >
        📴
      </button>
    </>
  );
}
