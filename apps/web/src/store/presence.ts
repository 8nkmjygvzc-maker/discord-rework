import { create } from 'zustand';
import type { PresenceUser } from '@parley/shared';
import { GatewayClient } from '../lib/gateway';
import { useAuthStore } from './auth';

/** Presence-Store: Gateway-Verbindung + Liste der Online-Nutzer. */
interface PresenceState {
  /** true, sobald das Gateway READY gemeldet hat. */
  connected: boolean;
  onlineUsers: PresenceUser[];

  /** Nach Login aufrufen – baut die Gateway-Verbindung auf. */
  connect: () => void;
  /** Beim Logout aufrufen – trennt sauber und leert den Zustand. */
  disconnect: () => void;
}

export const usePresenceStore = create<PresenceState>()((set) => {
  // Ein Client pro Tab; Handlers schreiben direkt in den Store.
  const client = new GatewayClient({
    getToken: (forceRefresh) => useAuthStore.getState().getGatewayToken(forceRefresh),

    onReady: (d) => set({ connected: true, onlineUsers: d.onlineUsers }),

    onPresenceUpdate: (d) =>
      set((s) => ({
        onlineUsers: d.online
          ? // Duplikate vermeiden – READY-Snapshot und Update können sich überschneiden.
            [...s.onlineUsers.filter((u) => u.id !== d.user.id), d.user]
          : s.onlineUsers.filter((u) => u.id !== d.user.id),
      })),

    onConnectionChange: (connected) => {
      // Bei Verbindungsverlust die Liste leeren – sie wäre veraltet;
      // der READY-Snapshot nach dem Reconnect füllt sie neu.
      if (!connected) set({ connected: false, onlineUsers: [] });
    },
  });

  return {
    connected: false,
    onlineUsers: [],
    connect: () => client.start(),
    disconnect: () => {
      client.stop();
      set({ connected: false, onlineUsers: [] });
    },
  };
});
