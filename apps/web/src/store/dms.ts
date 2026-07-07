import { create } from 'zustand';
import type { DmChannelInfo } from '@parley/shared';
import { useAuthStore } from './auth';

/**
 * DM-Kanäle des Nutzers (Phase 7). `selectedDmId` steuert die Home-Ansicht:
 * null = Freunde-Panel, sonst der Chat des gewählten DM-Kanals.
 */
interface DmsState {
  channels: DmChannelInfo[];
  loaded: boolean;
  selectedDmId: string | null;

  loadDms: () => Promise<void>;
  /** Öffnet (oder findet) den DM-Kanal zu einem Nutzer und wählt ihn aus. */
  openDm: (userId: string) => Promise<void>;
  selectDm: (channelId: string | null) => void;
  handleDmCreate: (channel: DmChannelInfo) => void;
  reset: () => void;
}

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

/** Einsortieren ohne Duplikate (REST-Antwort und Gateway-Event überschneiden sich). */
function upsert(channels: DmChannelInfo[], channel: DmChannelInfo): DmChannelInfo[] {
  return [...channels.filter((c) => c.id !== channel.id), channel].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

export const useDmsStore = create<DmsState>()((set) => ({
  channels: [],
  loaded: false,
  selectedDmId: null,

  loadDms: async () => {
    const channels = await authFetch<DmChannelInfo[]>('/api/dms');
    set((s) => ({
      channels,
      loaded: true,
      // Auswahl validieren – der Kanal könnte (nach Reconnect) weg sein.
      selectedDmId: channels.some((c) => c.id === s.selectedDmId) ? s.selectedDmId : null,
    }));
  },

  openDm: async (userId) => {
    const channel = await authFetch<DmChannelInfo>('/api/dms', {
      method: 'POST',
      body: { userId },
    });
    set((s) => ({ channels: upsert(s.channels, channel), selectedDmId: channel.id }));
  },

  selectDm: (channelId) => set({ selectedDmId: channelId }),

  handleDmCreate: (channel) => set((s) => ({ channels: upsert(s.channels, channel) })),

  reset: () => set({ channels: [], loaded: false, selectedDmId: null }),
}));

/** Mitglieder eines DM-Kanals (für die Sender-Key-Verteilung beim Senden). */
export function dmMemberIds(channelId: string): string[] | null {
  const dm = useDmsStore.getState().channels.find((c) => c.id === channelId);
  const me = useAuthStore.getState().user?.id;
  if (!dm || !me) return null;
  return [me, dm.otherUser.id];
}
