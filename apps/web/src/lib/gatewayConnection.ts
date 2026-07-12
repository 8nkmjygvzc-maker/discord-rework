import type {
  DmChannelInfo,
  KeyEnvelopeInfo,
  MessageCreatePayload,
  MessageDeletePayload,
  MessageInfo,
  PresenceSyncPayload,
  PresenceUpdatePayload,
  ReadyPayload,
  ServerMemberRemovePayload,
  ServerSelfRemovedPayload,
  SoundboardPlayPayload,
  SoundboardUpdatePayload,
  VoiceStateUpdatePayload,
} from '@parley/shared';
import { GatewayClient } from './gateway';
import { e2ee } from './e2ee';
import { resetAttachmentCache } from './attachments';
import { resetSoundboardCache } from './soundboard';
import { rememberChannelLabel, resetChannelLabels } from './notifications';
import { useAuthStore } from '../store/auth';
import { usePresenceStore } from '../store/presence';
import { useServersStore } from '../store/servers';
import { useMessagesStore } from '../store/messages';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';
import { useVoiceStore } from '../store/voice';
import { useSoundboardStore } from '../store/soundboard';
import { useNoticesStore } from '../store/notices';

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
        // Fehler nur loggen (Phase 15): Die API kann direkt nach einem
        // Reconnect kurz unerreichbar sein – der nächste READY lädt erneut.
        void useServersStore.getState().loadServers().catch(logReloadError('Server'));
        void useFriendsStore.getState().loadFriends().catch(logReloadError('Freunde'));
        void useDmsStore.getState().loadDms().catch(logReloadError('DMs'));
        void initCrypto();
        // Falls wir vor dem Reconnect in einem Sprachkanal waren: Roster-Session
        // serverseitig neu registrieren (die Medien-WS zum SFU läuft weiter).
        void useVoiceStore.getState().reregisterAfterReconnect();
        return;
      case 'PRESENCE_UPDATE':
        usePresenceStore.getState().handlePresenceUpdate(d as PresenceUpdatePayload);
        return;
      case 'PRESENCE_SYNC':
        usePresenceStore.getState().handlePresenceSync(d as PresenceSyncPayload);
        return;
      case 'FRIENDS_UPDATE':
        void useFriendsStore.getState().loadFriends().catch(logReloadError('Freunde'));
        return;
      case 'DM_CHANNEL_CREATE':
        useDmsStore.getState().handleDmCreate((d as { channel: DmChannelInfo }).channel);
        return;
      case 'VOICE_STATE_UPDATE':
        useVoiceStore.getState().handleVoiceStateUpdate(d as VoiceStateUpdatePayload);
        return;
      case 'SOUNDBOARD_PLAY':
        useSoundboardStore.getState().handleSoundboardPlay(d as SoundboardPlayPayload);
        return;
      case 'SOUNDBOARD_UPDATE':
        useSoundboardStore
          .getState()
          .handleSoundboardUpdate((d as SoundboardUpdatePayload).serverId);
        return;
      case 'MESSAGE_CREATE': {
        const { message, context } = d as MessageCreatePayload;
        // Kanal-Label für Benachrichtigungen merken (Phase 15) – nötig für
        // Kanäle von Servern, die gerade nicht ausgewählt sind.
        if (context) {
          rememberChannelLabel(
            message.channelId,
            `#${context.channelName} (${context.serverName})`,
          );
        }
        useMessagesStore.getState().handleMessageCreate(message);
        return;
      }
      case 'MESSAGE_UPDATE':
        useMessagesStore.getState().handleMessageUpdate((d as { message: MessageInfo }).message);
        return;
      case 'MESSAGE_DELETE': {
        const { channelId, messageId } = d as MessageDeletePayload;
        useMessagesStore.getState().handleMessageDelete(channelId, messageId);
        return;
      }
      case 'KEY_ENVELOPE':
        // Fehler nicht eskalieren: Der Umschlag bleibt bis zum Ack in der
        // Mailbox und wird beim nächsten syncEnvelopes erneut zugestellt.
        e2ee
          .handleEnvelopeEvent((d as { envelope: KeyEnvelopeInfo }).envelope)
          .catch((err: unknown) => console.warn('Schlüssel-Umschlag nicht verarbeitet:', err));
        return;
      case 'SERVER_MEMBER_REMOVE': {
        // Der Ausgetretene kennt die bisherigen Sender-Keys → vor der
        // nächsten eigenen Nachricht in diesem Server rotieren.
        e2ee
          .markServerForRotation((d as ServerMemberRemovePayload).serverId)
          .catch((err: unknown) => console.warn('Rotations-Vormerkung fehlgeschlagen:', err));
        useServersStore.getState().handleGatewayEvent(t, d);
        return;
      }
      case 'SERVER_SELF_REMOVED': {
        // Rückmeldung an den Gekickten/Gebannten (Phase 15). Die eigentliche
        // Entfernung erledigt das begleitende SERVER_MEMBER_REMOVE.
        const { serverName, cause, reason } = d as ServerSelfRemovedPayload;
        const what =
          cause === 'ban'
            ? `Du wurdest vom Server „${serverName}“ gebannt.`
            : `Du wurdest vom Server „${serverName}“ entfernt.`;
        useNoticesStore
          .getState()
          .pushNotice(
            cause === 'ban' ? 'Gebannt' : 'Entfernt',
            reason ? `${what}\nGrund: ${reason}` : what,
          );
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

/** Fehler-Logger für die READY-Reloads (Nutzdaten kommen beim nächsten READY). */
function logReloadError(what: string): (err: unknown) => void {
  return (err) => console.warn(`${what} nach (Re-)Connect nicht geladen:`, err);
}

export const gateway = {
  connect: (): void => client.start(),
  disconnect: (): void => {
    client.stop();
    e2ee.reset();
    resetAttachmentCache();
    resetSoundboardCache();
    resetChannelLabels();
    usePresenceStore.getState().handleDisconnected();
    useServersStore.getState().reset();
    useMessagesStore.getState().reset();
    useFriendsStore.getState().reset();
    useDmsStore.getState().reset();
    useVoiceStore.getState().reset();
    useSoundboardStore.getState().reset();
    useNoticesStore.getState().reset();
  },
};
