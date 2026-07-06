/**
 * Minimaler Promise-Wrapper um IndexedDB für das E2EE-Schlüsselmaterial.
 * Eine Datenbank PRO NUTZER (Name enthält die User-ID), damit sich mehrere
 * Accounts im selben Browser nicht gegenseitig die Schlüssel überschreiben.
 *
 * Stores:
 *   kv             – Identität, Signed Prekey, Rotations-Flags, Verarbeitungs-Log
 *   sessions       – 1:1-Ratchet-Sessions pro Gegenüber (userId)
 *   ownSenderKeys  – eigener Sender-Key-Zustand pro Kanal
 *   recvSenderKeys – empfangene Sender-Keys ("channelId:senderId:keyId")
 */

const DB_VERSION = 1;
const STORE_NAMES = ['kv', 'sessions', 'ownSenderKeys', 'recvSenderKeys'] as const;
export type CryptoStoreName = (typeof STORE_NAMES)[number];

export class CryptoDb {
  private constructor(private readonly db: IDBDatabase) {}

  static open(userId: string): Promise<CryptoDb> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`parley-crypto-${userId}`, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const name of STORE_NAMES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name);
          }
        }
      };
      request.onsuccess = () => resolve(new CryptoDb(request.result));
      request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht verfügbar'));
    });
  }

  get<T>(store: CryptoStoreName, key: string): Promise<T | undefined> {
    return this.request<T | undefined>(store, 'readonly', (s) => s.get(key));
  }

  put(store: CryptoStoreName, key: string, value: unknown): Promise<void> {
    return this.request(store, 'readwrite', (s) => s.put(value, key)).then(() => undefined);
  }

  delete(store: CryptoStoreName, key: string): Promise<void> {
    return this.request(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
  }

  close(): void {
    this.db.close();
  }

  private request<T>(
    store: CryptoStoreName,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB-Fehler'));
    });
  }
}
