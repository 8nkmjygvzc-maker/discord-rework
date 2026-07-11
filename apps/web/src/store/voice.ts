import { create } from 'zustand';
import type {
  ChannelInfo,
  VoiceJoinResponse,
  VoiceState,
  VoiceStateUpdatePayload,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { playSound } from '../lib/sounds';
// Nur Typen statisch – der VoiceClient (und damit mediasoup-client, ~700 KB) wird
// erst beim ersten Beitritt dynamisch geladen (Code-Splitting, Phase 15).
import type { VoiceClient, VideoTile } from '../lib/voice';

/**
 * Voice-Zustand (Phase 10/11). Orchestriert Beitritt/Verlassen/Mute/Deafen,
 * Kamera und Bildschirmfreigabe und hält das Roster (wer sitzt in welchem
 * Sprachkanal) des ausgewählten Servers sowie die aktiven Video-Kacheln.
 * Die eigentliche Medienlogik steckt in lib/voice.ts (VoiceClient).
 *
 * Die Voice-Verbindung ist unabhängig vom gerade angezeigten Server: man bleibt
 * verbunden, auch wenn man in einen anderen Server wechselt (wie Discord).
 */

type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface VoiceStoreState {
  /** Kanal, mit dem wir aktuell verbunden (oder am Verbinden) sind. */
  activeChannelId: string | null;
  status: VoiceStatus;
  selfMuted: boolean;
  selfDeafened: boolean;
  /** Eigene Kamera aktiv (Phase 11). */
  selfCameraOn: boolean;
  /** Eigene Bildschirmfreigabe aktiv (Phase 11). */
  selfScreenOn: boolean;
  /** false = Zuhörer-Modus (kein Mikrofon/keine Berechtigung). */
  hasMic: boolean;
  error: string | null;
  /** Roster des ausgewählten Servers (alle seine Sprachkanäle). */
  voiceStates: VoiceState[];
  /** Aktive Video-Streams (eigene + fremde) für die Video-Bühne. */
  videoTiles: VideoTile[];
  /** Wer gerade spricht (userId → true), aus der WebAudio-Pegelmessung (Phase 15). */
  speaking: Record<string, boolean>;

  setVoiceStates: (states: VoiceState[]) => void;
  handleVoiceStateUpdate: (d: VoiceStateUpdatePayload) => void;
  joinVoice: (channel: ChannelInfo) => Promise<void>;
  /** `silent` unterdrückt den Disconnect-Sound (interner Kanalwechsel). */
  leaveVoice: (opts?: { silent?: boolean }) => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  /** Vom VoiceClient bei unerwartetem Verbindungsende aufgerufen. */
  handleVoiceClosed: () => void;
  /** Nach Gateway-Reconnect: Session serverseitig neu registrieren. */
  reregisterAfterReconnect: () => Promise<void>;
  /** Aktuellen Selbst-Zustand (Mute/Deafen/Kamera/Screen) ans Roster pushen. */
  syncState: () => Promise<void>;
  reset: () => void;
}

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

// Der VoiceClient hält Medienzustand (Transporte, Tracks) außerhalb des Stores.
let client: VoiceClient | null = null;

export const useVoiceStore = create<VoiceStoreState>()((set, get) => ({
  activeChannelId: null,
  status: 'idle',
  selfMuted: false,
  selfDeafened: false,
  selfCameraOn: false,
  selfScreenOn: false,
  hasMic: false,
  error: null,
  voiceStates: [],
  videoTiles: [],
  speaking: {},

  setVoiceStates: (states) => set({ voiceStates: states }),

  handleVoiceStateUpdate: (d) =>
    set((s) => {
      const without = s.voiceStates.filter((v) => v.userId !== d.userId);
      if (d.state === null) return { voiceStates: without };
      return {
        voiceStates: [
          ...without,
          { channelId: d.channelId, userId: d.userId, username: d.username, ...d.state },
        ],
      };
    }),

  joinVoice: async (channel) => {
    const self = useAuthStore.getState().user;
    if (!self) return;
    // Bereits in einem anderen Kanal? Erst sauber trennen (Medien + Roster).
    // Silent: beim Kanalwechsel soll nur der Connect-Sound erklingen.
    if (get().activeChannelId && get().activeChannelId !== channel.id) {
      await get().leaveVoice({ silent: true });
    }
    set({
      activeChannelId: channel.id,
      status: 'connecting',
      error: null,
      selfMuted: false,
      selfDeafened: false,
      selfCameraOn: false,
      selfScreenOn: false,
      videoTiles: [],
      speaking: {},
    });

    try {
      // Voice-Modul (mediasoup-client) parallel zum Join-Request nachladen –
      // Rollup legt es dank ausschließlich dynamischem Import in einen eigenen
      // Chunk, der erst hier geladen wird (Code-Splitting, Phase 15).
      const voiceModule = import('../lib/voice');
      const res = await authFetch<VoiceJoinResponse>(`/api/voice/channels/${channel.id}/join`, {
        method: 'POST',
      });
      const { VoiceClient } = await voiceModule;
      client = new VoiceClient({
        self: { userId: self.id, username: self.username },
        onClosed: () => get().handleVoiceClosed(),
        onTilesChanged: (tiles) => set({ videoTiles: tiles }),
        onLocalVideoEnded: (source) => {
          if (source === 'cam') set({ selfCameraOn: false });
          else set({ selfScreenOn: false });
          void get().syncState();
        },
        onSpeakingChanged: (userId, speaking) =>
          set((s) => {
            if ((s.speaking[userId] === true) === speaking) return s;
            const next = { ...s.speaking };
            if (speaking) next[userId] = true;
            else delete next[userId];
            return { speaking: next };
          }),
      });
      await client.connect(res.voiceUrl, res.voiceToken);
      // Nur weitermachen, wenn der Nutzer nicht in der Zwischenzeit getrennt hat.
      if (get().activeChannelId !== channel.id) {
        client.disconnect();
        client = null;
        return;
      }
      set({ status: 'connected', hasMic: client.hasMic });
      playSound('connect');
    } catch (err) {
      client?.disconnect();
      client = null;
      // Session serverseitig wieder freigeben, falls sie schon angelegt wurde.
      void authFetch<void>(`/api/voice/channels/${channel.id}/leave`, { method: 'POST' }).catch(
        () => undefined,
      );
      set({
        status: 'error',
        activeChannelId: null,
        videoTiles: [],
        speaking: {},
        error: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen',
      });
    }
  },

  leaveVoice: async (opts) => {
    const channelId = get().activeChannelId;
    // Nur wenn wirklich eine Verbindung bestand (nicht bei Fehler-/Idle-Zustand).
    if (channelId && get().status === 'connected' && !opts?.silent) playSound('disconnect');
    client?.disconnect();
    client = null;
    set({
      activeChannelId: null,
      status: 'idle',
      selfMuted: false,
      selfDeafened: false,
      selfCameraOn: false,
      selfScreenOn: false,
      hasMic: false,
      videoTiles: [],
      speaking: {},
    });
    if (channelId) {
      await authFetch<void>(`/api/voice/channels/${channelId}/leave`, { method: 'POST' }).catch(
        () => undefined,
      );
    }
  },

  toggleMute: () => {
    const { selfMuted, selfDeafened, activeChannelId } = get();
    if (!activeChannelId) return;
    const muted = !selfMuted;
    // Stummschaltung aufheben hebt auch Deafen auf (man will wieder sprechen/hören).
    const deafened = muted ? selfDeafened : false;
    set({ selfMuted: muted, selfDeafened: deafened });
    void client?.setMicPaused(muted);
    if (!deafened) client?.setDeafened(false);
    void get().syncState();
  },

  toggleDeafen: () => {
    const { selfDeafened, activeChannelId } = get();
    if (!activeChannelId) return;
    const deafened = !selfDeafened;
    // Deafen impliziert Mute; Undeafen stellt den Hörmodus wieder her (unstumm).
    const muted = deafened ? true : false;
    set({ selfDeafened: deafened, selfMuted: muted });
    client?.setDeafened(deafened);
    void client?.setMicPaused(muted);
    void get().syncState();
  },

  toggleCamera: async () => {
    const { activeChannelId, selfCameraOn } = get();
    if (!activeChannelId || !client || get().status !== 'connected') return;
    try {
      if (selfCameraOn) {
        await client.stopCamera();
        set({ selfCameraOn: false });
      } else {
        await client.startCamera();
        set({ selfCameraOn: true });
      }
      void get().syncState();
    } catch (err) {
      // Kamera-Fehler (verweigert/kein Gerät) – Zustand unverändert lassen.
      set({ error: err instanceof Error ? err.message : 'Kamera nicht verfügbar' });
    }
  },

  toggleScreenShare: async () => {
    const { activeChannelId, selfScreenOn } = get();
    if (!activeChannelId || !client || get().status !== 'connected') return;
    try {
      if (selfScreenOn) {
        await client.stopScreenShare();
        set({ selfScreenOn: false });
      } else {
        await client.startScreenShare();
        set({ selfScreenOn: true });
      }
      void get().syncState();
    } catch {
      // Nutzer hat den Freigabe-Dialog abgebrochen o. Ä. – kein Fehler-Banner.
    }
  },

  handleVoiceClosed: () => {
    client = null;
    // Medien-WS ist weg – Roster serverseitig freigeben und UI zurücksetzen.
    const channelId = get().activeChannelId;
    if (channelId && get().status === 'connected') playSound('disconnect');
    if (channelId) {
      void authFetch<void>(`/api/voice/channels/${channelId}/leave`, { method: 'POST' }).catch(
        () => undefined,
      );
    }
    set({
      activeChannelId: null,
      status: 'idle',
      selfMuted: false,
      selfDeafened: false,
      selfCameraOn: false,
      selfScreenOn: false,
      hasMic: false,
      videoTiles: [],
      speaking: {},
    });
  },

  reregisterAfterReconnect: async () => {
    const { activeChannelId, selfMuted, selfDeafened, selfCameraOn, selfScreenOn, status } = get();
    if (!activeChannelId || status !== 'connected') return;
    // API kann die Session beim Neustart geleert haben → neu anlegen (Medien-WS
    // zum SFU läuft unabhängig weiter) und den vollen Zustand nachziehen.
    try {
      await authFetch<VoiceJoinResponse>(`/api/voice/channels/${activeChannelId}/join`, {
        method: 'POST',
      });
      if (selfMuted || selfDeafened || selfCameraOn || selfScreenOn) await get().syncState();
    } catch {
      /* Beim nächsten Reconnect erneut versucht. */
    }
  },

  syncState: () => {
    const { activeChannelId, selfMuted, selfDeafened, selfCameraOn, selfScreenOn } = get();
    if (!activeChannelId) return Promise.resolve();
    return authFetch<void>(`/api/voice/channels/${activeChannelId}/state`, {
      method: 'PATCH',
      body: {
        muted: selfMuted,
        deafened: selfDeafened,
        cameraOn: selfCameraOn,
        screenOn: selfScreenOn,
      },
    }).catch(() => undefined);
  },

  reset: () => {
    client?.disconnect();
    client = null;
    set({
      activeChannelId: null,
      status: 'idle',
      selfMuted: false,
      selfDeafened: false,
      selfCameraOn: false,
      selfScreenOn: false,
      hasMic: false,
      error: null,
      voiceStates: [],
      videoTiles: [],
      speaking: {},
    });
  },
}));
