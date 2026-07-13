/**
 * Verschlüsseltes Schlüssel-Backup (Multi-Browser-Support): Damit derselbe
 * Account in mehreren Browsern dieselbe E2EE-Identität benutzt, wird das
 * Identitätsschlüsselpaar (+ Signed Prekey) mit einem AUS DEM PASSWORT
 * abgeleiteten Schlüssel verschlüsselt und auf dem Server abgelegt.
 *
 * Der Server sieht nur Salt + Nonce + Ciphertext – ohne das Passwort kann er
 * das Backup nicht öffnen (Ableitung per PBKDF2, wie bei WhatsApp-Backups oder
 * dem Matrix-Key-Backup). Ehrlicher Trade-off: Beim Login sieht der Server das
 * Passwort ohnehin (Argon2id-Verifikation) – ein BÖSARTIGER Server könnte sich
 * den Backup-Schlüssel also merken. Das ist derselbe Vertrauensanker wie beim
 * ausgelieferten JS-Code (bekannte Web-E2EE-Einschränkung, siehe ROADMAP.md);
 * gegen reine DB-/Traffic-Leaks schützt das Backup weiterhin vollständig.
 *
 * PBKDF2 (WebCrypto) statt Argon2id: libsodium-wrappers (Standard-Build)
 * enthält crypto_pwhash nicht – statt auf die deutlich größere Sumo-Variante
 * zu wechseln, nutzt die Ableitung das eingebaute WebCrypto (Browser und
 * Node ≥ 20) mit OWASP-empfohlener Iterationszahl.
 */
import type { IdentityKeyPair, SignedPreKeyPair } from './keys';
import { fromB64, sodium, toB64, utf8ToBytes, bytesToUtf8 } from './sodium';

/** PBKDF2-SHA-256-Iterationen (OWASP-Empfehlung für SHA-256). */
const BACKUP_KDF_ITERATIONS = 600_000;

/** Wire-Format des Backups, wie es der Server speichert (GET/PUT /api/keys/backup). */
export interface KeyBackupBlob {
  v: 1;
  /** Argon2id-Salt (Base64) für die Schlüsselableitung aus dem Passwort. */
  salt: string;
  nonce: string;
  /** secretbox(JSON{identity, signedPreKey}, nonce, pwKey) als Base64. */
  ciphertext: string;
}

/** Inhalt des Backups – das komplette private Schlüsselmaterial der Identität. */
export interface KeyBackupContent {
  identity: IdentityKeyPair;
  signedPreKey: SignedPreKeyPair;
}

/** Neues Salt für eine frische Passwort-Ableitung. */
export function generateBackupSalt(): string {
  const s = sodium();
  return toB64(s.randombytes_buf(16));
}

/** Leitet den Backup-Schlüssel aus dem Login-Passwort ab (PBKDF2-SHA-256). */
export async function deriveBackupKey(password: string, salt: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', utf8ToBytes(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromB64(salt),
      iterations: BACKUP_KDF_ITERATIONS,
    },
    material,
    sodium().crypto_secretbox_KEYBYTES * 8,
  );
  return new Uint8Array(bits);
}

/** Verschlüsselt das Schlüsselmaterial zu einem hochladbaren Backup-Blob. */
export function encryptKeyBackup(
  content: KeyBackupContent,
  key: Uint8Array,
  salt: string,
): KeyBackupBlob {
  const s = sodium();
  const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
  const ciphertext = s.crypto_secretbox_easy(utf8ToBytes(JSON.stringify(content)), nonce, key);
  return { v: 1, salt, nonce: toB64(nonce), ciphertext: toB64(ciphertext) };
}

/** Öffnet ein Backup; wirft bei falschem Schlüssel (= anderes Passwort). */
export function decryptKeyBackup(blob: KeyBackupBlob, key: Uint8Array): KeyBackupContent {
  const s = sodium();
  const plaintext = s.crypto_secretbox_open_easy(
    fromB64(blob.ciphertext),
    fromB64(blob.nonce),
    key,
  );
  return JSON.parse(bytesToUtf8(plaintext)) as KeyBackupContent;
}
