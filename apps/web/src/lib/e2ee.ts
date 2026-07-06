/**
 * E2EE-Orchestrierung des Web-Clients (Phase 6).
 *
 * Lebenszyklus:
 *  1. `init(userId)` nach Login: Identität + Signed Prekey aus IndexedDB laden
 *     oder erzeugen, öffentliche Schlüssel per PUT /api/keys veröffentlichen.
 *  2. `syncEnvelopes()` holt liegengebliebene Schlüssel-Umschläge ab; live
 *     kommen sie als KEY_ENVELOPE-Gateway-Event über `handleEnvelopeEvent`.
 *  3. Senden: `encryptForChannel` sorgt erst dafür, dass alle Mitglieder den
 *     eigenen Sender-Key haben (Verteilung über 1:1-Ratchet-Sessions), und
 *     verschlüsselt dann die Nachricht.
 *  4. Empfangen: `decryptMessage` sucht den passenden empfangenen Sender-Key;
 *     fehlt er (noch), zeigt die UI einen Platzhalter und probiert es nach dem
 *     nächsten Umschlag erneut (`onSenderKeysChanged`).
 *
 * Multi-Tab: Alle zustandsverändernden Operationen laufen unter einem
 * Web Lock (ein Lock pro Nutzer). Entschlüsseln von Kanal-Nachrichten ist
 * bewusst idempotent (frühester Sender-Key-Stand bleibt gespeichert) und
 * braucht keinen Lock.
 */
import {
  bytesToUtf8,
  createSenderKey,
  cryptoReady,
  decryptChannelMessage,
  DeviceKeyBundle,
  generateIdentityKeyPair,
  generateSignedPreKey,
  IdentityKeyPair,
  KeyEnvelopeInfo,
  KeyEnvelopePayload,
  MessageInfo,
  OwnSenderKey,
  ratchetDecrypt,
  ratchetEncrypt,
  ratchetInitAsInitiator,
  ratchetInitAsResponder,
  RatchetState,
  ReceivedSenderKey,
  encryptChannelMessage,
  SenderKeyDistribution,
  senderKeyDistribution,
  SendMessageRequest,
  SignedPreKeyPair,
  utf8ToBytes,
  X3dhHeader,
  x3dhInitiate,
  x3dhRespond,
} from '@parley/shared';
import { ApiError } from './api';
import { CryptoDb } from './cryptoDb';
import { useAuthStore } from '../store/auth';

/** 1:1-Sessions zu einem Gegenüber. `outgoing` = von mir initiiert. */
interface PeerSessions {
  outgoing?: {
    state: RatchetState;
    /** X3DH-Header wird mitgeschickt, bis die Gegenseite antwortet (Phase 7). */
    x3dh: X3dhHeader;
    /** Identitätsschlüssel, an den die Session gebunden ist (Reset-Erkennung). */
    theirIdentityKey: string;
  };
  /** Von der Gegenseite initiierte Sessions, adressiert über deren X3DH-EK. */
  incoming: Record<string, RatchetState>;
}

interface OwnSenderKeyRecord {
  key: OwnSenderKey;
  serverId: string;
  createdAt: number;
  /** Wer den Schlüssel schon hat (Wert = Identitätsschlüssel des Empfängers). */
  distributedTo: Record<string, string>;
}

interface ReceivedSenderKeyRecord extends ReceivedSenderKey {
  channelId: string;
  senderId: string;
}

/** Wie lange ein Bundle-Lookup (auch ein 404) im Speicher gültig bleibt. */
const BUNDLE_CACHE_MS = 60_000;
/** Verarbeitete Umschlag-IDs, gegen doppelte Zustellung (Event + Abholung). */
const PROCESSED_LOG_LIMIT = 500;

let db: CryptoDb | null = null;
let currentUserId: string | null = null;
let identity: IdentityKeyPair | null = null;
let signedPreKey: SignedPreKeyPair | null = null;
let initPromise: Promise<void> | null = null;
const bundleCache = new Map<string, { bundle: DeviceKeyBundle | null; fetchedAt: number }>();
const keysChangedListeners = new Set<() => void>();

function authFetch<T>(
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<T> {
  return useAuthStore.getState().authFetch<T>(path, options);
}

/** Serialisiert Krypto-Operationen über Tabs hinweg (Fallback: nur dieser Tab). */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const name = `parley-crypto-${currentUserId ?? 'anon'}`;
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, fn) as Promise<T>;
  }
  return fn();
}

async function ensureReady(): Promise<CryptoDb> {
  if (initPromise) await initPromise;
  if (!db || !identity || !signedPreKey) throw new Error('E2EE ist nicht initialisiert');
  return db;
}

function notifyKeysChanged(): void {
  for (const listener of keysChangedListeners) listener();
}

export const e2ee = {
  /** Nach Login aufrufen: Schlüssel laden/erzeugen und veröffentlichen. */
  init(userId: string): Promise<void> {
    if (currentUserId === userId && initPromise) return initPromise;
    currentUserId = userId;
    const attempt: Promise<void> = (async () => {
      await cryptoReady();
      db = await CryptoDb.open(userId);
      identity = (await db.get<IdentityKeyPair>('kv', 'identity')) ?? null;
      signedPreKey = (await db.get<SignedPreKeyPair>('kv', 'spk')) ?? null;
      if (!identity || !signedPreKey) {
        identity = generateIdentityKeyPair();
        signedPreKey = generateSignedPreKey(identity);
        await db.put('kv', 'identity', identity);
        await db.put('kv', 'spk', signedPreKey);
      }
      // Öffentliche Schlüssel bei jedem Login veröffentlichen (idempotent) –
      // deckt auch den Fall ab, dass die Server-DB zurückgesetzt wurde.
      await authFetch<void>('/api/keys', {
        method: 'PUT',
        body: {
          identityKey: identity.signPublicKey,
          signedPreKey: signedPreKey.publicKey,
          signedPreKeySignature: signedPreKey.signature,
        },
      });
    })().catch((err: unknown) => {
      // Fehlschlag (z. B. Netzfehler beim Veröffentlichen) nicht einfrieren:
      // Der nächste (Re-)Connect soll die Initialisierung erneut versuchen.
      if (initPromise === attempt) initPromise = null;
      throw err;
    });
    initPromise = attempt;
    return attempt;
  },

  /** Bei Logout: Verbindungen kappen, Schlüssel bleiben in IndexedDB erhalten. */
  reset(): void {
    db?.close();
    db = null;
    currentUserId = null;
    identity = null;
    signedPreKey = null;
    initPromise = null;
    bundleCache.clear();
  },

  /** UI/Stores können erneut entschlüsseln, sobald neue Sender-Keys da sind. */
  onSenderKeysChanged(listener: () => void): () => void {
    keysChangedListeners.add(listener);
    return () => keysChangedListeners.delete(listener);
  },

  /** Liegengebliebene Umschläge abholen (nach Login/Reconnect). */
  async syncEnvelopes(): Promise<void> {
    await ensureReady();
    const envelopes = await authFetch<KeyEnvelopeInfo[]>('/api/envelopes');
    for (const envelope of envelopes) await processEnvelope(envelope);
    if (envelopes.length > 0) notifyKeysChanged();
  },

  /** Live zugestellter Umschlag (KEY_ENVELOPE-Gateway-Event). */
  async handleEnvelopeEvent(envelope: KeyEnvelopeInfo): Promise<void> {
    await ensureReady();
    await processEnvelope(envelope);
    notifyKeysChanged();
  },

  /**
   * Mitglieder-Austritt/Kick: Der Ausgetretene kennt die bisherigen
   * Sender-Keys – vor der nächsten Nachricht in diesem Server rotieren.
   */
  async markServerForRotation(serverId: string): Promise<void> {
    if (!db) return;
    await db.put('kv', `rotate:${serverId}`, Date.now());
  },

  /**
   * Verschlüsselt eine Kanal-Nachricht. Verteilt vorher den eigenen
   * Sender-Key an alle Mitglieder, die ihn noch nicht haben.
   */
  async encryptForChannel(
    channelId: string,
    serverId: string,
    memberIds: string[],
    plaintext: string,
  ): Promise<SendMessageRequest> {
    const database = await ensureReady();
    return withLock(async () => {
      let record = await database.get<OwnSenderKeyRecord>('ownSenderKeys', channelId);
      const rotateAt = (await database.get<number>('kv', `rotate:${serverId}`)) ?? 0;
      if (!record || record.createdAt < rotateAt) {
        record = await createOwnSenderKeyRecord(database, channelId, serverId);
      }
      await distributeSenderKey(database, record, channelId, memberIds);

      const { key, message } = encryptChannelMessage(record.key, channelId, plaintext);
      await database.put('ownSenderKeys', channelId, { ...record, key });
      return { ciphertext: message.ciphertext, nonce: message.nonce, header: message.header };
    });
  },

  /**
   * Entschlüsselt eine Nachricht oder liefert null, wenn der Sender-Key
   * (noch) fehlt – dann später über onSenderKeysChanged erneut versuchen.
   */
  async decryptMessage(message: MessageInfo): Promise<string | null> {
    if (initPromise) await initPromise;
    if (!db) return null;
    const recordKey = `${message.channelId}:${message.senderId}:${message.header.keyId}`;
    const received = await db.get<ReceivedSenderKeyRecord>('recvSenderKeys', recordKey);
    if (!received) return null;
    try {
      return decryptChannelMessage(received, message.channelId, {
        header: message.header,
        nonce: message.nonce,
        ciphertext: message.ciphertext,
      });
    } catch (err) {
      console.warn('Nachricht nicht entschlüsselbar:', err);
      return null;
    }
  },
};

// --- interne Helfer -----------------------------------------------------------

async function createOwnSenderKeyRecord(
  database: CryptoDb,
  channelId: string,
  serverId: string,
): Promise<OwnSenderKeyRecord> {
  const key = createSenderKey();
  // Schnappschuss des Anfangszustands für die EIGENEN Nachrichten – der
  // Sende-Zustand ratcht vorwärts, lesen läuft über denselben Weg wie bei
  // fremden Nachrichten.
  const selfRecord: ReceivedSenderKeyRecord = {
    ...senderKeyDistribution(key, channelId),
    channelId,
    senderId: currentUserId!,
  };
  await database.put('recvSenderKeys', `${channelId}:${currentUserId}:${key.keyId}`, selfRecord);
  return { key, serverId, createdAt: Date.now(), distributedTo: {} };
}

async function fetchBundle(userId: string): Promise<DeviceKeyBundle | null> {
  const cached = bundleCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < BUNDLE_CACHE_MS) return cached.bundle;
  try {
    const bundle = await authFetch<DeviceKeyBundle>(`/api/users/${userId}/keys`);
    bundleCache.set(userId, { bundle, fetchedAt: Date.now() });
    return bundle;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // Nutzer hat noch keine Schlüssel registriert – später erneut versuchen.
      bundleCache.set(userId, { bundle: null, fetchedAt: Date.now() });
      return null;
    }
    throw err;
  }
}

/** Verteilt den Sender-Key an alle Mitglieder, die ihn noch nicht haben. */
async function distributeSenderKey(
  database: CryptoDb,
  record: OwnSenderKeyRecord,
  channelId: string,
  memberIds: string[],
): Promise<void> {
  const distribution = JSON.stringify(senderKeyDistribution(record.key, channelId));
  for (const memberId of memberIds) {
    if (memberId === currentUserId) continue;
    const bundle = await fetchBundle(memberId);
    if (!bundle) continue;
    // „Schon verteilt“ zählt nur, solange der Identitätsschlüssel derselbe ist:
    // Nach einem Schlüssel-Reset (neuer Browser) braucht das Mitglied den
    // Sender-Key erneut – sonst bliebe es dauerhaft ohne Schlüssel.
    if (record.distributedTo[memberId] === bundle.identityKey) continue;
    try {
      const payload = await encryptEnvelopeTo(database, memberId, bundle, distribution);
      await authFetch<void>('/api/envelopes', {
        method: 'POST',
        body: { toUserId: memberId, payload },
      });
      record.distributedTo[memberId] = bundle.identityKey;
    } catch (err) {
      // Einzelner Fehlschlag blockiert das Senden nicht; nächster Versuch
      // beim nächsten Senden (Mitglied bleibt unmarkiert).
      console.warn(`Sender-Key-Verteilung an ${memberId} fehlgeschlagen:`, err);
    }
  }
  await database.put('ownSenderKeys', channelId, record);
}

/** Verschlüsselt eine Nutzlast über die 1:1-Session zu `peerId`. */
async function encryptEnvelopeTo(
  database: CryptoDb,
  peerId: string,
  bundle: DeviceKeyBundle,
  plaintext: string,
): Promise<KeyEnvelopePayload> {
  const sessions = (await database.get<PeerSessions>('sessions', peerId)) ?? { incoming: {} };

  // Session neu aufbauen, wenn keine existiert oder die Gegenseite ihre
  // Schlüssel zurückgesetzt hat (anderer Identitätsschlüssel).
  if (!sessions.outgoing || sessions.outgoing.theirIdentityKey !== bundle.identityKey) {
    // x3dhInitiate wirft bei ungültiger Prekey-Signatur → Bundle wird abgelehnt.
    const { sharedSecret, header } = x3dhInitiate(identity!, bundle);
    const ad = utf8ToBytes(identity!.signPublicKey + bundle.identityKey);
    sessions.outgoing = {
      state: ratchetInitAsInitiator(sharedSecret, bundle.signedPreKey, ad),
      x3dh: header,
      theirIdentityKey: bundle.identityKey,
    };
  }

  const { state, message } = ratchetEncrypt(sessions.outgoing.state, utf8ToBytes(plaintext));
  sessions.outgoing.state = state;
  await database.put('sessions', peerId, sessions);
  return {
    v: 1,
    type: 'senderKeyDistribution',
    x3dh: sessions.outgoing.x3dh,
    header: message.header,
    nonce: message.nonce,
    ciphertext: message.ciphertext,
  };
}

/** Verarbeitet einen Umschlag: Session finden/aufbauen, Sender-Key ablegen, Ack. */
async function processEnvelope(envelope: KeyEnvelopeInfo): Promise<void> {
  const database = db!;
  await withLock(async () => {
    const processed = (await database.get<string[]>('kv', 'processedEnvelopes')) ?? [];
    if (processed.includes(envelope.id)) {
      // Schon verarbeitet – aber das damalige Ack könnte fehlgeschlagen sein.
      // Erneut quittieren (DELETE ist idempotent), sonst bleibt der Umschlag
      // dauerhaft in der Mailbox liegen.
      await authFetch<void>(`/api/envelopes/${envelope.id}`, { method: 'DELETE' });
      return;
    }

    const payload = envelope.payload;
    try {
      if (payload.type !== 'senderKeyDistribution' || payload.v !== 1) {
        throw new Error(`Unbekannter Umschlag-Typ: ${payload.type}`);
      }
      const peerId = envelope.fromUserId;
      const sessions = (await database.get<PeerSessions>('sessions', peerId)) ?? { incoming: {} };

      if (!payload.x3dh) {
        throw new Error('Umschlag ohne X3DH-Header (in Phase 6 nicht vorgesehen)');
      }
      const sessionKey = payload.x3dh.ephemeralKey;
      const state =
        sessions.incoming[sessionKey] ??
        ratchetInitAsResponder(
          x3dhRespond(identity!, signedPreKey!, payload.x3dh),
          signedPreKey!,
          utf8ToBytes(payload.x3dh.identityKey + identity!.signPublicKey),
        );

      const { state: newState, plaintext } = ratchetDecrypt(state, {
        header: payload.header,
        nonce: payload.nonce,
        ciphertext: payload.ciphertext,
      });
      sessions.incoming[sessionKey] = newState;
      await database.put('sessions', peerId, sessions);

      const distribution = JSON.parse(bytesToUtf8(plaintext)) as SenderKeyDistribution;
      const recordKey = `${distribution.channelId}:${peerId}:${distribution.keyId}`;
      const existing = await database.get<ReceivedSenderKeyRecord>('recvSenderKeys', recordKey);
      // Frühesten Stand behalten – damit bleibt Entschlüsseln idempotent.
      if (!existing || existing.iteration > distribution.iteration) {
        await database.put('recvSenderKeys', recordKey, {
          keyId: distribution.keyId,
          chainKey: distribution.chainKey,
          iteration: distribution.iteration,
          signPublicKey: distribution.signPublicKey,
          channelId: distribution.channelId,
          senderId: peerId,
        } satisfies ReceivedSenderKeyRecord);
      }
    } catch (err) {
      // Nicht entschlüsselbare Umschläge (z. B. nach eigenem Schlüssel-Reset)
      // trotzdem quittieren, sonst blockieren sie die Mailbox dauerhaft.
      console.warn('Schlüssel-Umschlag nicht verarbeitbar:', err);
    }

    processed.push(envelope.id);
    await database.put('kv', 'processedEnvelopes', processed.slice(-PROCESSED_LOG_LIMIT));
    await authFetch<void>(`/api/envelopes/${envelope.id}`, { method: 'DELETE' });
  });
}
