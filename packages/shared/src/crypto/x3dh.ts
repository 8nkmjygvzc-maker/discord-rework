/**
 * X3DH-Schlüsselvereinbarung (nach der öffentlichen Signal-Spezifikation,
 * https://signal.org/docs/specifications/x3dh/), Variante ohne One-Time-Prekeys
 * – das ist der in der Spezifikation dokumentierte Fallback-Modus, wenn keine
 * OPKs verfügbar sind. One-Time-Prekeys stehen als Ausbau in der ROADMAP.
 *
 *   Initiator A → Responder B (B kennt A noch nicht):
 *     DH1 = DH(IK_A, SPK_B)
 *     DH2 = DH(EK_A, IK_B)
 *     DH3 = DH(EK_A, SPK_B)
 *     SK  = KDF(F || DH1 || DH2 || DH3)     F = 32 × 0xFF (Curve25519-Präfix)
 *
 * A schickt IK_A und EK_A im Klartext-Header mit; B rechnet dieselben DHs
 * spiegelbildlich. Als KDF dient BLAKE2b (crypto_generichash) mit festem Salt.
 */
import {
  DeviceKeyBundle,
  IdentityKeyPair,
  identityDhPrivateKey,
  identityDhPublicKey,
  SignedPreKeyPair,
  verifySignedPreKey,
} from './keys';
import { concatBytes, fromB64, sodium, toB64, utf8ToBytes } from './sodium';

/** Klartext-Header der ersten Nachricht einer Session (X3DH-Initialisierung). */
export interface X3dhHeader {
  /** Ed25519-Identitätsschlüssel des Initiators. */
  identityKey: string;
  /** Ephemerer X25519-Schlüssel des Initiators (EK_A). */
  ephemeralKey: string;
}

const F_PREFIX = new Uint8Array(32).fill(0xff);

function deriveSharedSecret(dh1: Uint8Array, dh2: Uint8Array, dh3: Uint8Array): Uint8Array {
  const s = sodium();
  const salt = s.crypto_generichash(32, utf8ToBytes('Parley/X3DH/v1'), null);
  return s.crypto_generichash(32, concatBytes(F_PREFIX, dh1, dh2, dh3), salt);
}

/**
 * Initiator-Seite: leitet das Shared Secret zum Bundle von B ab.
 * Wirft, wenn die Prekey-Signatur nicht zum Identitätsschlüssel passt.
 */
export function x3dhInitiate(
  myIdentity: IdentityKeyPair,
  theirBundle: DeviceKeyBundle,
): { sharedSecret: Uint8Array; header: X3dhHeader } {
  if (!verifySignedPreKey(theirBundle)) {
    throw new Error('X3DH: Prekey-Signatur ungültig – Bundle nicht vertrauenswürdig');
  }
  const s = sodium();
  const ephemeral = s.crypto_box_keypair();
  const theirSpk = fromB64(theirBundle.signedPreKey);
  const theirIkDh = identityDhPublicKey(theirBundle.identityKey);
  const myIkDhPriv = identityDhPrivateKey(myIdentity.signPrivateKey);

  const dh1 = s.crypto_scalarmult(myIkDhPriv, theirSpk);
  const dh2 = s.crypto_scalarmult(ephemeral.privateKey, theirIkDh);
  const dh3 = s.crypto_scalarmult(ephemeral.privateKey, theirSpk);

  return {
    sharedSecret: deriveSharedSecret(dh1, dh2, dh3),
    header: {
      identityKey: myIdentity.signPublicKey,
      ephemeralKey: toB64(ephemeral.publicKey),
    },
  };
}

/** Responder-Seite: rechnet das Shared Secret aus dem empfangenen Header nach. */
export function x3dhRespond(
  myIdentity: IdentityKeyPair,
  mySignedPreKey: SignedPreKeyPair,
  header: X3dhHeader,
): Uint8Array {
  const s = sodium();
  const spkPriv = fromB64(mySignedPreKey.privateKey);
  const theirIkDh = identityDhPublicKey(header.identityKey);
  const theirEk = fromB64(header.ephemeralKey);
  const myIkDhPriv = identityDhPrivateKey(myIdentity.signPrivateKey);

  const dh1 = s.crypto_scalarmult(spkPriv, theirIkDh);
  const dh2 = s.crypto_scalarmult(myIkDhPriv, theirEk);
  const dh3 = s.crypto_scalarmult(spkPriv, theirEk);

  return deriveSharedSecret(dh1, dh2, dh3);
}
