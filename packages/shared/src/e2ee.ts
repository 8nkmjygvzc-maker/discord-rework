/** API-Typen rund um Schlüsselverwaltung und -verteilung (Phase 6). */
import type { KeyEnvelopePayload } from './crypto/envelope';
import type { SealedBox } from './crypto/backup';

/** Body von PUT /api/keys – nur öffentliche Schlüssel. */
export interface RegisterKeysRequest {
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
}

/** Umschlag, wie er in der Mailbox liegt bzw. per Gateway ankommt. */
export interface KeyEnvelopeInfo {
  id: string;
  fromUserId: string;
  payload: KeyEnvelopePayload;
  createdAt: string;
}

/** Body von POST /api/envelopes. */
export interface SendKeyEnvelopeRequest {
  toUserId: string;
  payload: KeyEnvelopePayload;
}

// --- Schlüssel-Backup (Login auf neuem Gerät → History lesbar) ---------------

/**
 * Backup-Datensatz, wie GET /api/keys/backup ihn liefert. Der Server sieht nur
 * Salt/KDF-Parameter und zwei Ciphertexte – entschlüsseln kann er nichts.
 */
export interface KeyBackupRecord {
  kdfSalt: string;
  kdfOpsLimit: number;
  kdfMemLimit: number;
  /** Master-Key, umhüllt mit dem passwortabgeleiteten Schlüssel (Argon2id). */
  wrappedMasterKey: SealedBox;
  /** Kompletter Krypto-Zustand des Clients, verschlüsselt mit dem Master-Key. */
  blob: SealedBox;
  updatedAt: string;
}

/** Body von PUT /api/keys/backup (Einrichten bzw. komplett ersetzen). */
export interface PutKeyBackupRequest {
  kdfSalt: string;
  kdfOpsLimit: number;
  kdfMemLimit: number;
  wrappedMasterKey: SealedBox;
  blob: SealedBox;
}

/** Body von PUT /api/keys/backup/blob (laufende Aktualisierung des Zustands). */
export interface PutKeyBackupBlobRequest {
  blob: SealedBox;
}
