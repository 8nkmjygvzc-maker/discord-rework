/**
 * Schlüsselerzeugung (Phase 6). Jedes Gerät besitzt:
 *
 *  - ein Ed25519-Identitätsschlüsselpaar (signieren); für Diffie-Hellman wird
 *    es per libsodium in X25519 konvertiert (ein Identitätsschlüssel für
 *    Signatur UND DH, wie bei Signal)
 *  - einen signierten X25519-Prekey (SPK) für X3DH – die Signatur beweist,
 *    dass der Prekey wirklich zum Identitätsschlüssel gehört
 *
 * Alle öffentlichen Teile gehen zum Server, private Schlüssel bleiben im
 * Client (IndexedDB). Serialisierung durchgehend als URL-safe Base64.
 */
import { fromB64, sodium, toB64 } from './sodium';

/** Identität eines Geräts – nur `signPublicKey` verlässt das Gerät. */
export interface IdentityKeyPair {
  /** Ed25519 public key (wird veröffentlicht). */
  signPublicKey: string;
  /** Ed25519 private key (bleibt lokal!). */
  signPrivateKey: string;
}

/** Signierter Prekey – `publicKey` + `signature` werden veröffentlicht. */
export interface SignedPreKeyPair {
  publicKey: string;
  privateKey: string;
  /** Ed25519-Signatur über den Public Key, mit dem Identitätsschlüssel. */
  signature: string;
}

/** Öffentliches Schlüsselbündel eines Nutzers, wie der Server es ausliefert. */
export interface DeviceKeyBundle {
  userId: string;
  identityKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
}

export function generateIdentityKeyPair(): IdentityKeyPair {
  const s = sodium();
  const pair = s.crypto_sign_keypair();
  return {
    signPublicKey: toB64(pair.publicKey),
    signPrivateKey: toB64(pair.privateKey),
  };
}

export function generateSignedPreKey(identity: IdentityKeyPair): SignedPreKeyPair {
  const s = sodium();
  const pair = s.crypto_box_keypair(); // X25519
  const signature = s.crypto_sign_detached(pair.publicKey, fromB64(identity.signPrivateKey));
  return {
    publicKey: toB64(pair.publicKey),
    privateKey: toB64(pair.privateKey),
    signature: toB64(signature),
  };
}

export function verifySignedPreKey(bundle: DeviceKeyBundle): boolean {
  const s = sodium();
  try {
    return s.crypto_sign_verify_detached(
      fromB64(bundle.signedPreKeySignature),
      fromB64(bundle.signedPreKey),
      fromB64(bundle.identityKey),
    );
  } catch {
    return false;
  }
}

/** Ed25519-Public-Key → X25519 (für Diffie-Hellman in X3DH). */
export function identityDhPublicKey(signPublicKey: string): Uint8Array {
  return sodium().crypto_sign_ed25519_pk_to_curve25519(fromB64(signPublicKey));
}

/** Ed25519-Private-Key → X25519 (für Diffie-Hellman in X3DH). */
export function identityDhPrivateKey(signPrivateKey: string): Uint8Array {
  return sodium().crypto_sign_ed25519_sk_to_curve25519(fromB64(signPrivateKey));
}
