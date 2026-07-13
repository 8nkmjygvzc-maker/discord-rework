import { useState } from 'react';
import { useDmsStore } from '../store/dms';
import { useServersStore } from '../store/servers';
import { useSoundboardStore } from '../store/soundboard';
import { useVoiceStore } from '../store/voice';
import SoundboardDialog from './SoundboardDialog';

/**
 * Sprachverbindungs-Panel (Phase 10), erscheint über dem Nutzer-Panel, sobald
 * man mit einem Sprachkanal verbunden ist – mit Mute/Deafen/Trennen. Bleibt
 * sichtbar, auch wenn man in einen anderen Server/Home wechselt.
 */
export default function VoicePanel() {
  const status = useVoiceStore((s) => s.status);
  const activeChannelId = useVoiceStore((s) => s.activeChannelId);
  const activeServerId = useVoiceStore((s) => s.activeServerId);
  const selfMuted = useVoiceStore((s) => s.selfMuted);
  const selfDeafened = useVoiceStore((s) => s.selfDeafened);
  const selfCameraOn = useVoiceStore((s) => s.selfCameraOn);
  const selfScreenOn = useVoiceStore((s) => s.selfScreenOn);
  const hasMic = useVoiceStore((s) => s.hasMic);
  const error = useVoiceStore((s) => s.error);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const toggleCamera = useVoiceStore((s) => s.toggleCamera);
  const toggleScreenShare = useVoiceStore((s) => s.toggleScreenShare);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const nowPlaying = useSoundboardStore((s) => s.nowPlaying);
  const loadSoundboard = useSoundboardStore((s) => s.load);
  const [soundboardOpen, setSoundboardOpen] = useState(false);

  // Kanalnamen aus dem gerade gewählten Server ableiten (best effort – bei
  // anderem Server steht nur „Sprachkanal“).
  const channelName = useServersStore(
    (s) => s.selectedServer?.channels.find((c) => c.id === activeChannelId)?.name,
  );
  // Privater Anruf (DM): Partnernamen statt Kanalnamen anzeigen.
  const dmPartner = useDmsStore(
    (s) => s.channels.find((c) => c.id === activeChannelId)?.otherUser.username,
  );

  if (!activeChannelId && status !== 'error') return null;

  if (status === 'error') {
    return (
      <div className="border-t border-zinc-950/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
        Sprachverbindung fehlgeschlagen{error ? `: ${error}` : ''}
      </div>
    );
  }

  const connecting = status === 'connecting';

  return (
    <div className="border-t border-zinc-950/50 bg-zinc-950/60 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p
            className={`truncate text-xs font-semibold ${connecting ? 'text-amber-400' : 'text-emerald-400'}`}
          >
            {connecting ? 'Verbinde …' : dmPartner ? 'Im Anruf' : 'Sprache verbunden'}
          </p>
          <p className="truncate text-xs text-zinc-400">
            {dmPartner ? `📞 @${dmPartner}` : `🔊 ${channelName ?? 'Sprachkanal'}`}
          </p>
        </div>
        <button
          type="button"
          title="Verbindung trennen"
          onClick={() => void leaveVoice()}
          className="rounded p-1.5 text-zinc-400 hover:bg-red-950 hover:text-red-400"
        >
          📴
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!hasMic || connecting}
          title={
            hasMic ? (selfMuted ? 'Stummschaltung aufheben' : 'Stummschalten') : 'Kein Mikrofon'
          }
          onClick={toggleMute}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
            selfMuted || !hasMic
              ? 'bg-red-950/60 text-red-300'
              : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {!hasMic ? '🚫 Kein Mic' : selfMuted ? '🔇 Stumm' : '🎤 Mic'}
        </button>
        <button
          type="button"
          disabled={connecting}
          title={selfDeafened ? 'Ton wieder anschalten' : 'Ton aus (Deafen)'}
          onClick={toggleDeafen}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
            selfDeafened
              ? 'bg-red-950/60 text-red-300'
              : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {selfDeafened ? '🔕 Taub' : '🎧 Ton'}
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={connecting}
          title={selfCameraOn ? 'Kamera ausschalten' : 'Kamera einschalten'}
          onClick={() => void toggleCamera()}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
            selfCameraOn
              ? 'bg-emerald-800/70 text-emerald-200'
              : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {selfCameraOn ? '📹 Kamera an' : '📷 Kamera'}
        </button>
        <button
          type="button"
          disabled={connecting}
          title={selfScreenOn ? 'Freigabe beenden' : 'Bildschirm teilen'}
          onClick={() => void toggleScreenShare()}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
            selfScreenOn
              ? 'bg-emerald-800/70 text-emerald-200'
              : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {selfScreenOn ? '🖥️ Teilt' : '🖥️ Teilen'}
        </button>
      </div>

      {/* Soundboard ist ein Server-Feature – in privaten Anrufen ausblenden. */}
      {activeServerId && (
        <button
          type="button"
          disabled={connecting}
          title="Soundboard öffnen"
          onClick={() => {
            void loadSoundboard(activeServerId);
            setSoundboardOpen(true);
          }}
          className="mt-2 w-full rounded bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          🎶 Soundboard
        </button>
      )}

      {/* „X spielt Y“ – auch sichtbar, wenn das Soundboard geschlossen ist. */}
      {nowPlaying && (
        <p className="mt-2 truncate text-xs text-emerald-400">
          🔊 {nowPlaying.username}: {nowPlaying.label}
        </p>
      )}

      {soundboardOpen && <SoundboardDialog onClose={() => setSoundboardOpen(false)} />}
    </div>
  );
}
