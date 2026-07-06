import type {
  KeyEnvelopeInfo,
  MessageInfo,
  PresenceUpdatePayload,
  ReadyPayload,
  ServerMemberRemovePayload,
} from '@parley/shared';
import { GatewayClient } from './gateway';
import { e2ee } from './e2ee';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import { useServersStore } from '../store/servers';
import { useMessagesStore } from '../store/messages';

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
        void initCrypto();
        return;
      case 'PRESENCE_UPDATE':
        usePresenceStore.getState().handlePresenceUpdate(d as PresenceUpdatePayload);
        return;
      case 'MESSAGE_CREATE':
        useMessagesStore.getState().handleMessageCreate((d as { message: MessageInfo }).message);
        return;
      case 'KEY_ENVELOPE':
        void e2ee.handleEnvelopeEvent((d as { envelope: KeyEnvelopeInfo }).envelope);
        return;
      case 'SERVER_MEMBER_REMOVE': {
        // Der Ausgetretene kennt die bisherigen Sender-Keys → vor der
        // nächsten eigenen Nachricht in diesem Server rotieren.
        void e2ee.markServerForRotation((d as ServerMemberRemovePayload).serverId);
        useServersStore.getState().handleGatewayEvent(t, d);
        return;
      }
      default:
        useServersStore.getState().handleGatewayEvent(t, d);
    }
  },

  onConnectionChange: (connected) => {
    if (!connected) usePresenceStore.getState().handleDisconnected();
  },
});

/** Schlüssel bereitstellen/veröffentlichen und liegengebliebene Umschläge holen. */
async function initCrypto(): Promise<void> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return;
  try {
    await e2ee.init(userId);
    await e2ee.syncEnvelopes();
  } catch (err) {
    console.error('E2EE-Initialisierung fehlgeschlagen:', err);
  }
  // Auch ohne neue Umschläge: History könnte vor Abschluss der
  // Initialisierung geladen worden sein → einmal nachentschlüsseln.
  useMessagesStore.getState().retryUndecrypted();
}

// Neue Sender-Keys (Umschlag verarbeitet) → Unentschlüsseltes erneut versuchen.
e2ee.onSenderKeysChanged(() => useMessagesStore.getState().retryUndecrypted());

export const gateway = {
  connect: (): void => client.start(),
  disconnect: (): void => {
    client.stop();
    e2ee.reset();
    usePresenceStore.getState().handleDisconnected();
    useServersStore.getState().reset();
    useMessagesStore.getState().reset();
  },
};
