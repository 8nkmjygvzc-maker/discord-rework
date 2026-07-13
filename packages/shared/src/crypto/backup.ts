/**
 * Verschlüsseltes Schlüssel-Backup (Feature nach Phase 15).
 *
 * Problem: Die privaten E2EE-Schlüssel leben nur in der IndexedDB EINES
 * Browsers – ein Login auf einem neuen Gerät erzeugte bisher frische Schlüssel
 * und die gesamte History blieb unlesbar. Lösung (Prinzip wie WhatsApp-/
 * Signal-Backups):
 *
 *   1. Ein zufälliger 256-Bit-MASTER-KEY verschlüsselt den kompletten
 *      Krypto-Zustand des Clients (Identität, Sessions, Sender-Keys) zu einem
 *      Blob, der beim Server liegt.
 *   2. Der Master-Key selbst wird mit einem aus dem PASSWORT abgeleiteten
 *      Schlüssel (Argon2id, `crypto_pwhash`) umhüllt („wrapped“) und ebenfalls
 *      beim Server gespeichert.
 *
 * Der Server sieht nur Salt, KDF-Parameter und zwei Ciphertexte – ohne das
 * Passwort kann er weder Master-Key noch Blob entschlüsseln. Beim Login (das
 * Passwort ist dort ohnehin im Client vorhanden) wird der Master-Key
 * entpackt und der Zustand wiederhergestellt → alte Nachrichten sind lesbar.
 *
 * Ehrlicher Trade-off (in ROADMAP.md dokumentiert): Ein DB-Leak erlaubt
 * Offline-Brute-Force gegen das Passwort – genau wie beim ohnehin
 * gespeicherten Argon2id-Login-Hash, also keine neue Angriffsfläche. Und der
 * Server einer Web-App sieht das Passwort beim Login sowieso (bekannte
 * Web-E2EE-Einschränkung, siehe CLAUDE.md §6).
 */
import { fromB64, sodium, toB64, utf8ToBytes } from './sodium';

/** Domain-Separation für beide AEAD-Schichten. */
const WRAP_CONTEXT = 'parley/backup/wrap/v1';
const BLOB_CONTEXT = 'parley/backup/blob/v1|';

/** Ein AEAD-Ciphertext (XChaCha20-Poly1305) mit seiner Nonce, beides Base64. */
export interface SealedBox {
  nonce: string;
  ciphertext: string;
}

/** Empfohlene KDF-Parameter (libsodium INTERACTIVE: 64 MiB, 2 Iterationen). */
export function backupKdfDefaults(): { opsLimit: number; memLimit: number } {
  const s = sodium();
  return {
    opsLimit: s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    memLimit: s.crypto_pwhash_MEMLIMIT_INTERACTIVE,
  };
}

export function generateBackupSalt(): string {
  const s = sodium();
  return toB64(s.randombytes_buf(s.crypto_pwhash_SALTBYTES));
}

export function generateBackupMasterKey(): string {
  return toB64(sodium().randombytes_buf(32));
}

/**
 * Leitet den Wrap-Schlüssel (KEK) aus dem Passwort ab. Argon2id ist bewusst
 * teuer (~1 s) – das läuft nur einmal beim Login bzw. beim Einrichten.
 */
export function deriveBackupKek(
  password: string,
  saltB64: string,
  opsLimit: number,
  memLimit: number,
): Uint8Array {
  const s = sodium();
  return s.crypto_pwhash(
    32,
    password,
    fromB64(saltB64),
    opsLimit,
    memLimit,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function seal(key: Uint8Array, plaintext: Uint8Array, ad: string): SealedBox {
  const s = sodium();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    utf8ToBytes(ad),
    null,
    nonce,
    key,
  );
  return { nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
}

/** Wirft bei falschem Schlüssel/AD oder manipuliertem Ciphertext. */
function open(key: Uint8Array, box: SealedBox, ad: string): Uint8Array {
  const s = sodium();
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    fromB64(box.ciphertext),
    utf8ToBytes(ad),
    fromB64(box.nonce),
    key,
  );
}

/** Master-Key mit dem passwortabgeleiteten KEK umhüllen. */
export function wrapBackupMasterKey(masterKeyB64: string, kek: Uint8Array): SealedBox {
  return seal(kek, fromB64(masterKeyB64), WRAP_CONTEXT);
}

/** Master-Key entpacken – wirft bei falschem Passwort. */
export function unwrapBackupMasterKey(box: SealedBox, kek: Uint8Array): string {
  return toB64(open(kek, box, WRAP_CONTEXT));
}

/**
 * Zustands-Blob verschlüsseln. Das AD bindet die User-ID, damit ein (böser)
 * Server nicht den Blob eines anderen Kontos unterschieben kann.
 */
export function encryptBackupBlob(
  masterKeyB64: string,
  plaintextJson: string,
  userId: string,
): SealedBox {
  return seal(fromB64(masterKeyB64), utf8ToBytes(plaintextJson), BLOB_CONTEXT + userId);
}

/** Zustands-Blob entschlüsseln – wirft bei Manipulation oder falschem Key. */
export function decryptBackupBlob(masterKeyB64: string, box: SealedBox, userId: string): string {
  return sodium().to_string(open(fromB64(masterKeyB64), box, BLOB_CONTEXT + userId));
}
