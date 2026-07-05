import type { PresenceUpdatePayload, ReadyPayload } from '@parley/shared';
import { GatewayClient } from './gateway';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import { useServersStore } from '../store/servers';

/**
 * Die eine Gateway-Verbindung des Tabs. Verteilt Dispatch-Events an die
 * zuständigen Stores – die Stores kennen den WebSocket selbst nicht.
 */
const client = new GatewayClient({
  getToken: (forceRefresh) => useAuthStore.getState().getGatewayToken(forceRefresh),

  onDispatch: (t, d) => {
    switch (t) {
      case 'READY':
        usePresenceStore.getState().handleReady(d as ReadyPayload);
        // Nach (Re-)Connect den REST-Stand nachziehen – Events, die während
        // einer Trennung passiert sind, sind unwiederbringlich verpasst.
        void useServersStore.getState().loadServers();
        return;
      case 'PRESENCE_UPDATE':
        usePresenceStore.getState().handlePresenceUpdate(d as PresenceUpdatePayload);
        return;
      default:
        useServersStore.getState().handleGatewayEvent(t, d);
    }
  },

  onConnectionChange: (connected) => {
    if (!connected) usePresenceStore.getState().handleDisconnected();
  },
});

export const gateway = {
  connect: (): void => client.start(),
  disconnect: (): void => {
    client.stop();
    usePresenceStore.getState().handleDisconnected();
    useServersStore.getState().reset();
  },
};
