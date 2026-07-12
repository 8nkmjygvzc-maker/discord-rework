import { create } from 'zustand';
import type { DmChannelInfo, PublicUser } from '@parley/shared';
import { useAuthStore } from './auth';

/**
 * DM-Kanäle des Nutzers (Phase 7). `selectedDmId` steuert die Home-Ansicht:
 * null = Freunde-Panel, sonst der Chat des gewählten DM-Kanals.
 *
 * Phase 15: `unread` zählt live eingetroffene DM-Nachrichten pro Kanal,
 * solange der Kanal nicht offen ist. Nur im Speicher – was während einer
 * Trennung ankommt, wird nicht nachträglich als ungelesen markiert (wie die
 * In-App-Benachrichtigungen). `activeDmId` meldet die gerade GERENDERTE
 * DM-ChatView (nicht nur die Auswahl: die bleibt auch beim Wechsel in einen
 * Server bestehen, dann sollen Nachrichten trotzdem als ungelesen zählen).
 */
interface DmsState {
  channels: DmChannelInfo[];
  loaded: boolean;
  selectedDmId: string | null;
  /** channelId → Anzahl ungelesener Nachrichten (Phase 15). */
  unread: Record<string, number>;
  /** DM-Kanal, dessen ChatView gerade sichtbar ist (sonst null). */
  activeDmId: string | null;

  loadDms: () => Promise<void>;
  /** Öffnet (oder findet) den DM-Kanal zu einem Nutzer und wählt ihn aus. */
  openDm: (userId: string) => Promise<void>;
  selectDm: (channelId: string | null) => void;
  handleDmCreate: (channel: DmChannelInfo) => void;
  /** Von der ChatView gemeldet: DM sichtbar → Ungelesen-Zähler löschen. */
  setActiveDm: (channelId: string | null) => void;
  /** Live eingetroffene fremde DM-Nachricht als ungelesen zählen. */
  markUnread: (channelId: string) => void;
  /** USER_UPDATE (Phase 15): Status/Avatar des DM-Partners aktualisieren. */
  applyUserUpdate: (user: PublicUser) => void;
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

/** Zähler eines Kanals entfernen (ohne neues Objekt, wenn nichts zu tun ist). */
function clearUnread(unread: Record<string, number>, channelId: string): Record<string, number> {
  if (!(channelId in unread)) return unread;
  const next = { ...unread };
  delete next[channelId];
  return next;
}

export const useDmsStore = create<DmsState>()((set, get) => ({
  channels: [],
  loaded: false,
  selectedDmId: null,
  unread: {},
  activeDmId: null,

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
    set((s) => ({
      channels: upsert(s.channels, channel),
      selectedDmId: channel.id,
      unread: clearUnread(s.unread, channel.id),
    }));
  },

  selectDm: (channelId) =>
    set((s) => ({
      selectedDmId: channelId,
      unread: channelId ? clearUnread(s.unread, channelId) : s.unread,
    })),

  handleDmCreate: (channel) => set((s) => ({ channels: upsert(s.channels, channel) })),

  setActiveDm: (channelId) =>
    set((s) => ({
      activeDmId: channelId,
      unread: channelId ? clearUnread(s.unread, channelId) : s.unread,
    })),

  markUnread: (channelId) => {
    const s = get();
    // Nur echte DM-Kanäle zählen, und nicht den, der gerade sichtbar ist.
    if (s.activeDmId === channelId) return;
    if (!s.channels.some((c) => c.id === channelId)) return;
    set({ unread: { ...s.unread, [channelId]: (s.unread[channelId] ?? 0) + 1 } });
  },

  applyUserUpdate: (user) =>
    set((s) => ({
      channels: s.channels.map((c) =>
        c.otherUser.id === user.id ? { ...c, otherUser: { ...c.otherUser, ...user } } : c,
      ),
    })),

  reset: () =>
    set({ channels: [], loaded: false, selectedDmId: null, unread: {}, activeDmId: null }),
}));

/** Mitglieder eines DM-Kanals (für die Sender-Key-Verteilung beim Senden). */
export function dmMemberIds(channelId: string): string[] | null {
  const dm = useDmsStore.getState().channels.find((c) => c.id === channelId);
  const me = useAuthStore.getState().user?.id;
  if (!dm || !me) return null;
  return [me, dm.otherUser.id];
}
