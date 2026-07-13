/** API-Typen rund um Schlüsselverwaltung und -verteilung (Phase 6). */
import type { KeyEnvelopePayload } from './crypto/envelope';

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

/**
 * Verschlüsseltes Schlüssel-Backup (Multi-Browser): GET/PUT /api/keys/backup.
 * Inhalt und Ableitung siehe crypto/backup.ts – der Server speichert nur
 * diesen undurchsichtigen Blob.
 */
export interface KeyBackupInfo {
  salt: string;
  nonce: string;
  ciphertext: string;
  updatedAt: string;
}

/** Body von PUT /api/keys/backup. */
export interface SaveKeyBackupRequest {
  salt: string;
  nonce: string;
  ciphertext: string;
  /**
   * true = nur anlegen, wenn noch keins existiert (409 sonst) – verhindert,
   * dass zwei Browser beim ersten Login gegenseitig ihre Backups überschreiben.
   */
  onlyIfMissing?: boolean;
}

/**
 * Wie lange der Server Schlüssel-Umschläge aufbewahrt. Seit dem
 * Multi-Browser-Support werden Umschläge nicht mehr nach dem ersten Abruf
 * gelöscht (jeder Browser des Accounts braucht sie), sondern laufen ab.
 * Browser, die länger als diese Frist offline waren, können ältere
 * Nachrichten ggf. nicht mehr entschlüsseln.
 */
export const ENVELOPE_RETENTION_DAYS = 30;
