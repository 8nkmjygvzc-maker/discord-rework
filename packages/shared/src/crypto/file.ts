/**
 * Datei-Verschlüsselung für Anhänge (Phase 8).
 *
 * Jede Datei bekommt einen frischen, zufälligen Schlüssel (XChaCha20-Poly1305).
 * Hochgeladen wird NUR der Ciphertext; Schlüssel + Nonce wandern zusammen mit
 * Dateiname/MIME-Typ im E2EE-verschlüsselten Nachrichtentext zu den Empfängern
 * (gleiches Prinzip wie verschlüsselte Anhänge bei Matrix/Signal). Der Server
 * sieht damit weder Inhalt noch Dateinamen oder Dateityp.
 */
import { fromB64, sodium, toB64 } from './sodium';

export interface EncryptedFileBytes {
  /** Zufälliger Dateischlüssel (Base64) – nie an den Server, nur in die Nachricht. */
  key: string;
  nonce: string;
  ciphertext: Uint8Array;
}

export function encryptFileBytes(plain: Uint8Array): EncryptedFileBytes {
  const s = sodium();
  const key = s.crypto_aead_xchacha20poly1305_ietf_keygen();
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  // Kein AD nötig: Der Schlüssel ist pro Datei einmalig, eine Verwechslung
  // mit anderen Ciphertexten ist damit ausgeschlossen.
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(plain, null, null, nonce, key);
  return { key: toB64(key), nonce: toB64(nonce), ciphertext };
}

/** Wirft, wenn Schlüssel/Nonce nicht passen oder der Blob manipuliert wurde. */
export function decryptFileBytes(key: string, nonce: string, ciphertext: Uint8Array): Uint8Array {
  const s = sodium();
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    fromB64(nonce),
    fromB64(key),
  );
}
