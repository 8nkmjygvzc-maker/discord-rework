/**
 * Sender-Key-Ratchet für Kanäle (Prinzip wie Megolm bei Matrix):
 *
 * Jedes Mitglied hat pro Kanal einen eigenen Sende-Schlüssel, bestehend aus
 * einer vorwärts ratchenden Symmetrie-Kette (BLAKE2b-Kette wie beim Double
 * Ratchet) plus einem Ed25519-Signaturpaar. Der Zustand wird einmalig über
 * die 1:1-Ratchet-Sessions an alle Mitglieder verteilt; danach kann jede
 * Nachricht lokal entschlüsselt werden.
 *
 * Empfänger behalten den FRÜHESTEN bekannten Kettenzustand und spulen zum
 * Entschlüsseln vor (Ableitung ist deterministisch). Das macht Entschlüsseln
 * idempotent – wichtig bei mehreren Tabs – und erlaubt History-Lesen ab dem
 * Zeitpunkt der Schlüsselverteilung. Nachrichten VOR dem eigenen Beitritt
 * bleiben prinzipbedingt unlesbar (Verteilung enthält nur den aktuellen Stand).
 *
 * Signatur: Jede Nachricht ist mit dem Sender-Key-Signaturschlüssel signiert,
 * damit Mitglieder (die ja denselben symmetrischen Schlüssel kennen) keine
 * Nachrichten im Namen des Absenders fälschen können.
 */
import { concatBytes, fromB64, sodium, toB64 } from './sodium';

/** Eigener Sende-Zustand (mit privatem Signaturschlüssel – bleibt lokal). */
export interface OwnSenderKey {
  keyId: string;
  chainKey: string;
  iteration: number;
  signPublicKey: string;
  signPrivateKey: string;
}

/** Empfangener Zustand eines fremden Senders (frühester bekannter Stand). */
export interface ReceivedSenderKey {
  keyId: string;
  chainKey: string;
  iteration: number;
  signPublicKey: string;
}

/** Über die 1:1-Session verteilte Nutzlast. */
export interface SenderKeyDistribution {
  channelId: string;
  keyId: string;
  chainKey: string;
  iteration: number;
  signPublicKey: string;
}

/** Klartext-Header jeder verschlüsselten Kanal-Nachricht. */
export interface EncryptedMessageHeader {
  v: 1;
  keyId: string;
  iteration: number;
  /** Ed25519-Signatur über AD ‖ Nonce ‖ Ciphertext. */
  signature: string;
}

export interface EncryptedChannelMessage {
  header: EncryptedMessageHeader;
  nonce: string;
  ciphertext: string;
}

/** Obergrenze fürs Vorspulen – schützt vor DoS über absurde Iterationswerte. */
const MAX_FORWARD = 20_000;

function chainStep(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const s = sodium();
  return {
    messageKey: s.crypto_generichash(32, new Uint8Array([0x01]), chainKey),
    nextChainKey: s.crypto_generichash(32, new Uint8Array([0x02]), chainKey),
  };
}

function associatedData(channelId: string, keyId: string, iteration: number): Uint8Array {
  return sodium().from_string(`parley/msg/v1|${channelId}|${keyId}|${iteration}`);
}

export function createSenderKey(): OwnSenderKey {
  const s = sodium();
  const signPair = s.crypto_sign_keypair();
  return {
    keyId: toB64(s.randombytes_buf(16)),
    chainKey: toB64(s.randombytes_buf(32)),
    iteration: 0,
    signPublicKey: toB64(signPair.publicKey),
    signPrivateKey: toB64(signPair.privateKey),
  };
}

/** Verteilungs-Nutzlast mit dem AKTUELLEN Stand (ältere Nachrichten bleiben zu). */
export function senderKeyDistribution(key: OwnSenderKey, channelId: string): SenderKeyDistribution {
  return {
    channelId,
    keyId: key.keyId,
    chainKey: key.chainKey,
    iteration: key.iteration,
    signPublicKey: key.signPublicKey,
  };
}

export function encryptChannelMessage(
  key: OwnSenderKey,
  channelId: string,
  plaintext: string,
): { key: OwnSenderKey; message: EncryptedChannelMessage } {
  const s = sodium();
  const { messageKey, nextChainKey } = chainStep(fromB64(key.chainKey));
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ad = associatedData(channelId, key.keyId, key.iteration);
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    s.from_string(plaintext),
    ad,
    null,
    nonce,
    messageKey,
  );
  const signature = s.crypto_sign_detached(
    concatBytes(ad, nonce, ciphertext),
    fromB64(key.signPrivateKey),
  );
  return {
    key: { ...key, chainKey: toB64(nextChainKey), iteration: key.iteration + 1 },
    message: {
      header: { v: 1, keyId: key.keyId, iteration: key.iteration, signature: toB64(signature) },
      nonce: toB64(nonce),
      ciphertext: toB64(ciphertext),
    },
  };
}

/**
 * Entschlüsselt eine Kanal-Nachricht anhand des frühesten bekannten Zustands.
 * Verändert den Zustand NICHT (idempotent). Wirft bei ungültiger Signatur,
 * manipuliertem Ciphertext oder Iteration vor dem eigenen Kenntnisstand.
 */
export function decryptChannelMessage(
  key: ReceivedSenderKey,
  channelId: string,
  message: EncryptedChannelMessage,
): string {
  const s = sodium();
  const { header } = message;
  if (header.keyId !== key.keyId) throw new Error('SenderKey: falsche keyId');
  const steps = header.iteration - key.iteration;
  if (steps < 0) throw new Error('SenderKey: Nachricht liegt vor dem verteilten Stand');
  if (steps > MAX_FORWARD) throw new Error('SenderKey: Iteration unplausibel weit voraus');

  const ad = associatedData(channelId, header.keyId, header.iteration);
  const nonce = fromB64(message.nonce);
  const ciphertext = fromB64(message.ciphertext);
  const valid = s.crypto_sign_verify_detached(
    fromB64(header.signature),
    concatBytes(ad, nonce, ciphertext),
    fromB64(key.signPublicKey),
  );
  if (!valid) throw new Error('SenderKey: Signatur ungültig');

  let chainKey = fromB64(key.chainKey);
  for (let i = 0; i < steps; i++) chainKey = chainStep(chainKey).nextChainKey;
  const { messageKey } = chainStep(chainKey);
  const plaintext = s.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    ad,
    nonce,
    messageKey,
  );
  return s.to_string(plaintext);
}
