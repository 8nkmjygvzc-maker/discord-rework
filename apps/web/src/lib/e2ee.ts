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
 *
 * Multi-Browser (gleicher Account in mehreren Browsern): Alle Browser teilen
 * sich EINE Identität über ein passwortverschlüsseltes Schlüssel-Backup auf
 * dem Server (syncKeyBackup). Sender-Keys werden zusätzlich an sich selbst
 * verteilt und Umschläge bleiben serverseitig für ENVELOPE_RETENTION_DAYS
 * liegen – so kann jeder Browser des Accounts (auch ein später dazugekommener)
 * die eigenen wie fremden Nachrichten des Zeitraums entschlüsseln.
 */
import {
  bytesToUtf8,
  createSenderKey,
  cryptoReady,
  decryptChannelMessage,
  decryptKeyBackup,
  deriveBackupKey,
  DeviceKeyBundle,
  encryptKeyBackup,
  fromB64,
  generateBackupSalt,
  generateIdentityKeyPair,
  generateSignedPreKey,
  IdentityKeyPair,
  KeyBackupContent,
  KeyBackupInfo,
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
  toB64,
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
  /** null bei DM-Kanälen – Rotations-Flags gelten pro Server (Phase 7). */
  serverId: string | null;
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
/**
 * Verarbeitete Umschlag-IDs, gegen doppelte Verarbeitung. Seit dem
 * Multi-Browser-Support bleiben Umschläge serverseitig liegen (Retention statt
 * Löschen beim Ack) – das Log muss deshalb die ganze Mailbox abdecken.
 */
const PROCESSED_LOG_LIMIT = 2000;

let db: CryptoDb | null = null;
let currentUserId: string | null = null;
let identity: IdentityKeyPair | null = null;
let signedPreKey: SignedPreKeyPair | null = null;
let initPromise: Promise<void> | null = null;
/**
 * Login-Passwort, bis init() es für das Schlüssel-Backup verbraucht hat
 * (Multi-Browser). Lebt nur im Speicher und wird nach erfolgreichem
 * Backup-Abgleich sofort verworfen – es wird NIE geloggt oder persistiert.
 */
let pendingPassword: string | null = null;
/**
 * In dieser Sitzung nicht entschlüsselbare Umschläge (Wert = Identität beim
 * Versuch): bleiben in der Server-Mailbox liegen und werden erst nach einem
 * Identitätswechsel (Backup-Übernahme) erneut versucht statt bei jedem Sync.
 */
const failedEnvelopes = new Map<string, string>();
const bundleCache = new Map<string, { bundle: DeviceKeyBundle | null; fetchedAt: number }>();
const keysChangedListeners = new Set<() => void>();

/** In IndexedDB gemerkter Backup-Schlüssel (abgeleitet aus dem Passwort). */
interface StoredBackupKey {
  salt: string;
  key: string;
}

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
  /**
   * Direkt nach erfolgreichem Passwort-Login/Registrieren aufrufen: init()
   * braucht das Passwort einmalig, um den Backup-Schlüssel abzuleiten
   * (Multi-Browser). Ohne Stash läuft init() mit dem in IndexedDB gemerkten
   * Schlüssel weiter (Session-Restore) bzw. lässt das Backup unangetastet.
   */
  stashLoginPassword(password: string): void {
    pendingPassword = password;
  },

  /** Nach Login aufrufen: Schlüssel laden/erzeugen und veröffentlichen. */
  init(userId: string): Promise<void> {
    if (currentUserId === userId && initPromise) return initPromise;
    currentUserId = userId;
    // `let … = null` statt `const`: TS kann sonst nicht beweisen, dass die
    // Zuweisung vor der ersten Verwendung im Closure passiert (TS2454).
    let attempt: Promise<void> | null = null;
    attempt = (async () => {
      await cryptoReady();
      // Lokal arbeiten, erst am Ende committen (Phase 15): Ein reset()
      // während der awaits (Logout, StrictMode-Remount der Verbindung) setzt
      // die Globals auf null – dieser Lauf darf danach weder darauf zugreifen
      // noch sein Ergebnis eintragen.
      const openedDb = await CryptoDb.open(userId);
      try {
        let id = (await openedDb.get<IdentityKeyPair>('kv', 'identity')) ?? null;
        let spk = (await openedDb.get<SignedPreKeyPair>('kv', 'spk')) ?? null;
        if (!id || !spk) {
          id = generateIdentityKeyPair();
          spk = generateSignedPreKey(id);
          await openedDb.put('kv', 'identity', id);
          await openedDb.put('kv', 'spk', spk);
        }
        // Multi-Browser: Schlüssel-Backup abgleichen – existiert eins, wird
        // dessen Identität übernommen (alle Browser des Accounts teilen sich
        // EINE Identität); sonst wird das eigene Material hochgeladen.
        try {
          ({ id, spk } = await syncKeyBackup(openedDb, id, spk));
          pendingPassword = null;
        } catch (err) {
          // Backup-Probleme (z. B. Netzfehler) blockieren E2EE nicht – der
          // nächste (Re-)Connect versucht den Abgleich erneut.
          console.warn('Schlüssel-Backup-Abgleich fehlgeschlagen:', err);
        }
        // Öffentliche Schlüssel bei jedem Login veröffentlichen (idempotent) –
        // deckt auch den Fall ab, dass die Server-DB zurückgesetzt wurde.
        await authFetch<void>('/api/keys', {
          method: 'PUT',
          body: {
            identityKey: id.signPublicKey,
            signedPreKey: spk.publicKey,
            signedPreKeySignature: spk.signature,
          },
        });
        if (initPromise !== attempt) {
          // Inzwischen reset()/Nutzerwechsel: Ergebnis verwerfen.
          openedDb.close();
          return;
        }
        db = openedDb;
        identity = id;
        signedPreKey = spk;
      } catch (err) {
        openedDb.close();
        throw err;
      }
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
    pendingPassword = null;
    failedEnvelopes.clear();
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
   * Verschlüsselt eine Kanal-Nachricht (Server-Kanal oder DM, Phase 7).
   * Verteilt vorher den eigenen Sender-Key an alle Mitglieder, die ihn noch
   * nicht haben. `serverId` ist null bei DMs – dort gibt es keine
   * Mitglieder-Fluktuation und damit keine Rotations-Flags.
   */
  async encryptForChannel(
    channelId: string,
    serverId: string | null,
    memberIds: string[],
    plaintext: string,
  ): Promise<SendMessageRequest> {
    const database = await ensureReady();
    return withLock(async () => {
      let record = await database.get<OwnSenderKeyRecord>('ownSenderKeys', channelId);
      const rotateAt = serverId
        ? ((await database.get<number>('kv', `rotate:${serverId}`)) ?? 0)
        : 0;
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

/**
 * Schlüssel-Backup abgleichen (Multi-Browser). Ablauf:
 *  - Backup vorhanden und zu öffnen (gemerkter Schlüssel oder frisches
 *    Login-Passwort) → dessen Identität übernehmen, falls sie von der lokalen
 *    abweicht. Empfangene Sender-Keys bleiben gültig (symmetrisch), nur die
 *    identitätsgebundenen 1:1-Sessions werden verworfen und bauen sich neu auf.
 *  - Kein Backup → eigenes Material verschlüsselt hochladen (onlyIfMissing:
 *    verlieren zwei Browser das Rennen, übernimmt der zweite das des ersten).
 *  - Backup nicht zu öffnen (anderes Passwort) → mit frischem Passwort durch
 *    ein neues aus den lokalen Schlüsseln ersetzen; ohne Passwort unverändert
 *    mit den lokalen Schlüsseln weiterarbeiten.
 */
async function syncKeyBackup(
  database: CryptoDb,
  id: IdentityKeyPair,
  spk: SignedPreKeyPair,
): Promise<{ id: IdentityKeyPair; spk: SignedPreKeyPair }> {
  const password = pendingPassword;
  const stored = (await database.get<StoredBackupKey>('kv', 'backupKey')) ?? null;

  let backup: KeyBackupInfo | null;
  try {
    backup = await authFetch<KeyBackupInfo>('/api/keys/backup');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) backup = null;
    else throw err;
  }

  if (!backup) {
    let kek = stored;
    if (!kek && password) {
      const salt = generateBackupSalt();
      kek = { salt, key: toB64(await deriveBackupKey(password, salt)) };
    }
    // Ohne Passwort und ohne gemerkten Schlüssel lässt sich kein Backup
    // anlegen – passiert beim nächsten Passwort-Login.
    if (!kek) return { id, spk };
    const blob = encryptKeyBackup({ identity: id, signedPreKey: spk }, fromB64(kek.key), kek.salt);
    try {
      await authFetch<void>('/api/keys/backup', {
        method: 'PUT',
        body: {
          salt: blob.salt,
          nonce: blob.nonce,
          ciphertext: blob.ciphertext,
          onlyIfMissing: true,
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Ein anderer Browser hat gerade zuerst hochgeladen – seins übernehmen.
        return syncKeyBackup(database, id, spk);
      }
      throw err;
    }
    await database.put('kv', 'backupKey', kek);
    return { id, spk };
  }

  // Backup vorhanden: Schlüssel besorgen (gemerkt oder aus dem Passwort ableiten).
  let kek = stored && stored.salt === backup.salt ? stored : null;
  if (!kek && password) {
    kek = { salt: backup.salt, key: toB64(await deriveBackupKey(password, backup.salt)) };
  }
  if (!kek) return { id, spk }; // ohne Passwort nicht zu öffnen – später erneut

  let content: KeyBackupContent;
  try {
    content = decryptKeyBackup(
      { v: 1, salt: backup.salt, nonce: backup.nonce, ciphertext: backup.ciphertext },
      fromB64(kek.key),
    );
  } catch {
    if (!password) return { id, spk };
    // Totes Backup (z. B. unter anderem Passwort angelegt): mit dem frisch
    // bestätigten Passwort durch ein neues aus den lokalen Schlüsseln ersetzen.
    console.warn('Schlüssel-Backup nicht entschlüsselbar – wird ersetzt');
    const salt = generateBackupSalt();
    const fresh: StoredBackupKey = { salt, key: toB64(await deriveBackupKey(password, salt)) };
    const blob = encryptKeyBackup({ identity: id, signedPreKey: spk }, fromB64(fresh.key), salt);
    await authFetch<void>('/api/keys/backup', {
      method: 'PUT',
      body: { salt: blob.salt, nonce: blob.nonce, ciphertext: blob.ciphertext },
    });
    await database.put('kv', 'backupKey', fresh);
    return { id, spk };
  }

  await database.put('kv', 'backupKey', kek);
  if (content.identity.signPublicKey === id.signPublicKey) return { id, spk };

  // Identität aus dem Backup übernehmen.
  await database.put('kv', 'identity', content.identity);
  await database.put('kv', 'spk', content.signedPreKey);
  await database.clear('sessions');
  return { id: content.identity, spk: content.signedPreKey };
}

/** Eigenes öffentliches Bündel – für die Sender-Key-Verteilung an sich selbst. */
function ownBundle(): DeviceKeyBundle {
  return {
    userId: currentUserId!,
    identityKey: identity!.signPublicKey,
    signedPreKey: signedPreKey!.publicKey,
    signedPreKeySignature: signedPreKey!.signature,
  };
}

async function createOwnSenderKeyRecord(
  database: CryptoDb,
  channelId: string,
  serverId: string | null,
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
  // Auch an SICH SELBST verteilen (Multi-Browser): Andere Browser desselben
  // Accounts teilen über das Schlüssel-Backup dieselbe Identität und lesen
  // den Umschlag aus der Mailbox – erst dadurch sind die eigenen Nachrichten
  // auch dort entschlüsselbar. Das eigene Bündel liegt lokal vor.
  const recipients = [...new Set([currentUserId!, ...memberIds])];
  for (const memberId of recipients) {
    const bundle = memberId === currentUserId ? ownBundle() : await fetchBundle(memberId);
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

/**
 * Verarbeitet einen Umschlag: Session finden/aufbauen, Sender-Key ablegen.
 * Umschläge bleiben serverseitig liegen (Retention, Multi-Browser) – welche
 * schon verarbeitet sind, merkt sich jeder Browser selbst.
 */
async function processEnvelope(envelope: KeyEnvelopeInfo): Promise<void> {
  const database = db!;
  await withLock(async () => {
    const processed = (await database.get<string[]>('kv', 'processedEnvelopes')) ?? [];
    if (processed.includes(envelope.id)) return;
    // In dieser Sitzung bereits gescheitert (z. B. an eine andere Identität
    // gerichtet): erst nach einem Identitätswechsel erneut versuchen.
    if (failedEnvelopes.get(envelope.id) === identity!.signPublicKey) return;

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
      // Nicht entschlüsselbar (z. B. an eine andere Identität dieses Accounts
      // gerichtet, Migration auf das Schlüssel-Backup): NICHT als verarbeitet
      // markieren – nach einer Identitätsübernahme klappt es womöglich doch.
      // Bis dahin verhindert failedEnvelopes wiederholte Versuche pro Sync.
      failedEnvelopes.set(envelope.id, identity!.signPublicKey);
      console.warn('Schlüssel-Umschlag (noch) nicht verarbeitbar:', err);
      return;
    }

    failedEnvelopes.delete(envelope.id);
    processed.push(envelope.id);
    await database.put('kv', 'processedEnvelopes', processed.slice(-PROCESSED_LOG_LIMIT));
  });
}
