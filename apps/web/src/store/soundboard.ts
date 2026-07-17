import { create } from 'zustand';
import {
  MAX_SOUNDBOARD_SOUND_BYTES,
  SoundboardPlayPayload,
  SoundboardSoundInfo,
  UpdateSoundboardSoundRequest,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { useVoiceStore } from './voice';
import { playSoundboardSound, probeUploadableAudio } from '../lib/soundboard';

/**
 * Soundboard-Zustand: die geladene Sound-Bibliothek (des Servers, mit dessen
 * Sprachkanal wir verbunden sind), Upload/Verwaltung und die Reaktion auf die
 * Gateway-Events SOUNDBOARD_PLAY (lokal abspielen) und SOUNDBOARD_UPDATE
 * (Bibliothek neu laden).
 */

interface SoundboardStoreState {
  /** Server, dessen Bibliothek gerade geladen ist (null = nichts geladen). */
  serverId: string | null;
  sounds: SoundboardSoundInfo[];
  loading: boolean;
  error: string | null;
  /** „X spielt Y“-Anzeige; verschwindet nach ein paar Sekunden von selbst. */
  nowPlaying: { username: string; label: string } | null;

  load: (serverId: string) => Promise<void>;
  handleSoundboardUpdate: (serverId: string) => void;
  handleSoundboardPlay: (payload: SoundboardPlayPayload) => void;
  /** Sound im aktuellen Sprachkanal für alle abspielen (REST-Trigger). */
  play: (soundId: string) => Promise<void>;
  upload: (
    serverId: string,
    file: File,
    meta: { name: string; emoji?: string; volume?: number },
  ) => Promise<void>;
  update: (serverId: string, soundId: string, patch: UpdateSoundboardSoundRequest) => Promise<void>;
  remove: (serverId: string, soundId: string) => Promise<void>;
  reset: () => void;
}

// Timer für das automatische Ausblenden der „X spielt Y“-Anzeige.
let nowPlayingTimer: ReturnType<typeof setTimeout> | null = null;

export const useSoundboardStore = create<SoundboardStoreState>()((set, get) => ({
  serverId: null,
  sounds: [],
  loading: false,
  error: null,
  nowPlaying: null,

  load: async (serverId) => {
    set({ serverId, loading: true, error: null });
    try {
      const sounds = await useAuthStore
        .getState()
        .authFetch<SoundboardSoundInfo[]>(`/api/servers/${serverId}/soundboard`);
      // Antwort verwerfen, wenn inzwischen ein anderer Server geladen wird.
      if (get().serverId === serverId) set({ sounds, loading: false });
    } catch (err) {
      if (get().serverId === serverId) {
        set({ loading: false, error: err instanceof Error ? err.message : 'Laden fehlgeschlagen' });
      }
    }
  },

  handleSoundboardUpdate: (serverId) => {
    // Nur neu laden, wenn genau diese Bibliothek gerade im Speicher liegt.
    if (get().serverId === serverId) void get().load(serverId);
  },

  handleSoundboardPlay: (payload) => {
    const voice = useVoiceStore.getState();
    // Nur abspielen, wenn wir wirklich (noch) in diesem Sprachkanal sitzen –
    // und nicht bei aktivem Deafen (wer nichts hören will, hört auch das nicht).
    if (voice.activeChannelId !== payload.channelId || voice.status !== 'connected') return;
    if (!voice.selfDeafened) void playSoundboardSound(payload.sound);
    const label = payload.sound.emoji
      ? `${payload.sound.emoji} ${payload.sound.name}`
      : payload.sound.name;
    set({ nowPlaying: { username: payload.username, label } });
    if (nowPlayingTimer) clearTimeout(nowPlayingTimer);
    nowPlayingTimer = setTimeout(() => set({ nowPlaying: null }), 4000);
  },

  play: async (soundId) => {
    const channelId = useVoiceStore.getState().activeChannelId;
    if (!channelId) return;
    set({ error: null });
    try {
      await useAuthStore
        .getState()
        .authFetch<void>(`/api/voice/channels/${channelId}/soundboard/${soundId}/play`, {
          method: 'POST',
        });
      // Die eigene Wiedergabe kommt über das SOUNDBOARD_PLAY-Event (wie bei allen).
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Abspielen fehlgeschlagen' });
    }
  },

  upload: async (serverId, file, meta) => {
    if (file.size > MAX_SOUNDBOARD_SOUND_BYTES) {
      throw new Error(`„${file.name}“ ist größer als 10 MiB`);
    }
    const mimeType = file.type;
    if (!mimeType.startsWith('audio/')) {
      throw new Error(`„${file.name}“ ist keine Audiodatei`);
    }
    // Dekodierbarkeit prüfen, BEVOR Bytes zum Server wandern.
    await probeUploadableAudio(file);

    const params = new URLSearchParams({ name: meta.name, mimeType });
    if (meta.emoji) params.set('emoji', meta.emoji);
    if (meta.volume !== undefined) params.set('volume', String(meta.volume));
    await useAuthStore
      .getState()
      .authUpload<SoundboardSoundInfo>(
        `/api/servers/${serverId}/soundboard?${params.toString()}`,
        new Uint8Array(await file.arrayBuffer()),
      );
    // Liste sofort nachziehen (das SOUNDBOARD_UPDATE-Event macht dasselbe –
    // doppeltes Laden ist harmlos, aber so ist die UI auch ohne Event aktuell).
    await get().load(serverId);
  },

  update: async (serverId, soundId, patch) => {
    await useAuthStore
      .getState()
      .authFetch<SoundboardSoundInfo>(`/api/servers/${serverId}/soundboard/${soundId}`, {
        method: 'PATCH',
        body: patch,
      });
    await get().load(serverId);
  },

  remove: async (serverId, soundId) => {
    await useAuthStore
      .getState()
      .authFetch<void>(`/api/servers/${serverId}/soundboard/${soundId}`, { method: 'DELETE' });
    await get().load(serverId);
  },

  reset: () => {
    if (nowPlayingTimer) {
      clearTimeout(nowPlayingTimer);
      nowPlayingTimer = null;
    }
    set({ serverId: null, sounds: [], loading: false, error: null, nowPlaying: null });
  },
}));
