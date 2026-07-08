import { create } from 'zustand';
import type {
  ChannelInfo,
  VoiceJoinResponse,
  VoiceState,
  VoiceStateUpdatePayload,
} from '@parley/shared';
import { useAuthStore } from './auth';
import { VoiceClient } from '../lib/voice';

/**
 * Voice-Zustand (Phase 10). Orchestriert Beitritt/Verlassen/Mute/Deafen und
 * hält das Roster (wer sitzt in welchem Sprachkanal) des ausgewählten Servers.
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
  /** false = Zuhörer-Modus (kein Mikrofon/keine Berechtigung). */
  hasMic: boolean;
  error: string | null;
  /** Roster des ausgewählten Servers (alle seine Sprachkanäle). */
  voiceStates: VoiceState[];

  setVoiceStates: (states: VoiceState[]) => void;
  handleVoiceStateUpdate: (d: VoiceStateUpdatePayload) => void;
  joinVoice: (channel: ChannelInfo) => Promise<void>;
  leaveVoice: () => Promise<void>;
  toggleMute: () => void;
  toggleDeafen: () => void;
  /** Vom VoiceClient bei unerwartetem Verbindungsende aufgerufen. */
  handleVoiceClosed: () => void;
  /** Nach Gateway-Reconnect: Session serverseitig neu registrieren. */
  reregisterAfterReconnect: () => Promise<void>;
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
  hasMic: false,
  error: null,
  voiceStates: [],

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
    // Bereits in einem anderen Kanal? Erst sauber trennen (Medien + Roster).
    if (get().activeChannelId && get().activeChannelId !== channel.id) {
      await get().leaveVoice();
    }
    set({
      activeChannelId: channel.id,
      status: 'connecting',
      error: null,
      selfMuted: false,
      selfDeafened: false,
    });

    try {
      const res = await authFetch<VoiceJoinResponse>(`/api/voice/channels/${channel.id}/join`, {
        method: 'POST',
      });
      client = new VoiceClient({ onClosed: () => get().handleVoiceClosed() });
      await client.connect(res.voiceUrl, res.voiceToken);
      // Nur weitermachen, wenn der Nutzer nicht in der Zwischenzeit getrennt hat.
      if (get().activeChannelId !== channel.id) {
        client.disconnect();
        client = null;
        return;
      }
      set({ status: 'connected', hasMic: client.hasMic });
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
        error: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen',
      });
    }
  },

  leaveVoice: async () => {
    const channelId = get().activeChannelId;
    client?.disconnect();
    client = null;
    set({
      activeChannelId: null,
      status: 'idle',
      selfMuted: false,
      selfDeafened: false,
      hasMic: false,
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
    void pushState(activeChannelId, muted, deafened);
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
    void pushState(activeChannelId, muted, deafened);
  },

  handleVoiceClosed: () => {
    client = null;
    // Medien-WS ist weg – Roster serverseitig freigeben und UI zurücksetzen.
    const channelId = get().activeChannelId;
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
      hasMic: false,
    });
  },

  reregisterAfterReconnect: async () => {
    const { activeChannelId, selfMuted, selfDeafened, status } = get();
    if (!activeChannelId || status !== 'connected') return;
    // API kann die Session beim Neustart geleert haben → neu anlegen (Medien-WS
    // zum SFU läuft unabhängig weiter) und den Mute-/Deafen-Zustand nachziehen.
    try {
      await authFetch<VoiceJoinResponse>(`/api/voice/channels/${activeChannelId}/join`, {
        method: 'POST',
      });
      if (selfMuted || selfDeafened) await pushState(activeChannelId, selfMuted, selfDeafened);
    } catch {
      /* Beim nächsten Reconnect erneut versucht. */
    }
  },

  reset: () => {
    client?.disconnect();
    client = null;
    set({
      activeChannelId: null,
      status: 'idle',
      selfMuted: false,
      selfDeafened: false,
      hasMic: false,
      error: null,
      voiceStates: [],
    });
  },
}));

function pushState(channelId: string, muted: boolean, deafened: boolean): Promise<void> {
  return authFetch<void>(`/api/voice/channels/${channelId}/state`, {
    method: 'PATCH',
    body: { muted, deafened },
  }).catch(() => undefined);
}
