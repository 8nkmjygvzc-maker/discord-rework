import { create } from 'zustand';
import type { PresenceUpdatePayload, PresenceUser, ReadyPayload } from '@parley/shared';

/**
 * Presence-Zustand (Online-Nutzer + Verbindungsstatus). Die Gateway-Verbindung
 * selbst lebt in lib/gatewayConnection.ts und ruft die handle*-Methoden auf.
 */
interface PresenceState {
  /** true, sobald das Gateway READY gemeldet hat. */
  connected: boolean;
  onlineUsers: PresenceUser[];

  handleReady: (d: ReadyPayload) => void;
  handlePresenceUpdate: (d: PresenceUpdatePayload) => void;
  handleDisconnected: () => void;
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  connected: false,
  onlineUsers: [],

  handleReady: (d) => set({ connected: true, onlineUsers: d.onlineUsers }),

  handlePresenceUpdate: (d) =>
    set((s) => ({
      onlineUsers: d.online
        ? // Duplikate vermeiden – READY-Snapshot und Update können sich überschneiden.
          [...s.onlineUsers.filter((u) => u.id !== d.user.id), d.user]
        : s.onlineUsers.filter((u) => u.id !== d.user.id),
    })),

  // Liste leeren – sie wäre veraltet; der READY-Snapshot nach Reconnect füllt sie neu.
  handleDisconnected: () => set({ connected: false, onlineUsers: [] }),
}));
