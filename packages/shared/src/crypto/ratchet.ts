/**
 * Double Ratchet (nach der öffentlichen Signal-Spezifikation,
 * https://signal.org/docs/specifications/doubleratchet/), aufgebaut aus
 * libsodium-Primitiven:
 *
 *   KDF_RK  = BLAKE2b-512, keyed mit Root Key, Input = DH-Output → RK' ‖ CK
 *   KDF_CK  = BLAKE2b-256, keyed mit Chain Key, Input 0x01 → Message Key,
 *                                              Input 0x02 → nächster Chain Key
 *   AEAD    = XChaCha20-Poly1305 (Header als Associated Data)
 *
 * Alle Funktionen sind PURE: Sie verändern den übergebenen Zustand nicht,
 * sondern liefern einen neuen. Erst wenn Ver-/Entschlüsselung erfolgreich war,
 * darf der Aufrufer den neuen Zustand persistieren – ein fehlgeschlagener
 * Entschlüsselungsversuch kann die Session so nie korrumpieren.
 *
 * In Phase 6 transportieren diese Sessions die Sender-Key-Verteilung für
 * Kanäle; Phase 7 nutzt sie direkt für Direktnachrichten.
 */
import { concatBytes, fromB64, sodium, toB64, utf8ToBytes } from './sodium';

/** Serialisierbarer Session-Zustand (Base64-Strings → IndexedDB/JSON-tauglich). */
export interface RatchetState {
  /** Root Key der KDF-Kette. */
  rootKey: string;
  /** Eigenes DH-Ratchet-Schlüsselpaar. */
  dhsPublic: string;
  dhsPrivate: string;
  /** DH-Ratchet-Public-Key der Gegenseite (null, bis erste Nachricht ankam). */
  dhr: string | null;
  /** Sende- und Empfangs-Chain-Keys. */
  cks: string | null;
  ckr: string | null;
  /** Nachrichtenzähler: Senden, Empfangen, Länge der vorherigen Sendekette. */
  ns: number;
  nr: number;
  pn: number;
  /** Message Keys übersprungener Nachrichten: "dhrPub:n" → Key. */
  skipped: Record<string, string>;
  /** Associated Data der Session (bindet beide Identitätsschlüssel). */
  ad: string;
}

/** Klartext-Header jeder Ratchet-Nachricht. */
export interface RatchetHeader {
  /** Aktueller DH-Ratchet-Public-Key des Absenders. */
  dh: string;
  /** Länge der vorherigen Sendekette (für Skipped Keys beim Kettenwechsel). */
  pn: number;
  /** Laufende Nummer in der aktuellen Sendekette. */
  n: number;
}

export interface RatchetMessage {
  header: RatchetHeader;
  nonce: string;
  ciphertext: string;
}

/** Obergrenze übersprungener Nachrichten – schützt vor DoS durch riesige n. */
const MAX_SKIP = 512;

// --- KDFs ---------------------------------------------------------------------

function kdfRootKey(rootKey: Uint8Array, dhOutput: Uint8Array): [Uint8Array, Uint8Array] {
  const out = sodium().crypto_generichash(64, dhOutput, rootKey);
  return [out.slice(0, 32), out.slice(32, 64)];
}

function kdfChainKey(chainKey: Uint8Array): { messageKey: Uint8Array; nextChainKey: Uint8Array } {
  const s = sodium();
  return {
    messageKey: s.crypto_generichash(32, new Uint8Array([0x01]), chainKey),
    nextChainKey: s.crypto_generichash(32, new Uint8Array([0x02]), chainKey),
  };
}

function headerBytes(header: RatchetHeader): Uint8Array {
  return utf8ToBytes(`${header.dh}|${header.pn}|${header.n}`);
}

// --- Initialisierung -----------------------------------------------------------

/**
 * Initiator (hat X3DH gestartet): nutzt den Signed Prekey der Gegenseite als
 * deren ersten Ratchet-Key und kann sofort senden.
 */
export function ratchetInitAsInitiator(
  sharedSecret: Uint8Array,
  theirSignedPreKey: string,
  ad: Uint8Array,
): RatchetState {
  const s = sodium();
  const dhs = s.crypto_box_keypair();
  const dhOut = s.crypto_scalarmult(dhs.privateKey, fromB64(theirSignedPreKey));
  const [rootKey, cks] = kdfRootKey(sharedSecret, dhOut);
  return {
    rootKey: toB64(rootKey),
    dhsPublic: toB64(dhs.publicKey),
    dhsPrivate: toB64(dhs.privateKey),
    dhr: theirSignedPreKey,
    cks: toB64(cks),
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    ad: toB64(ad),
  };
}

/**
 * Responder: sein Signed Prekey ist sein erstes Ratchet-Schlüsselpaar; die
 * Sendekette entsteht mit dem ersten DH-Ratchet-Schritt nach Empfang.
 */
export function ratchetInitAsResponder(
  sharedSecret: Uint8Array,
  mySignedPreKey: { publicKey: string; privateKey: string },
  ad: Uint8Array,
): RatchetState {
  return {
    rootKey: toB64(sharedSecret),
    dhsPublic: mySignedPreKey.publicKey,
    dhsPrivate: mySignedPreKey.privateKey,
    dhr: null,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    skipped: {},
    ad: toB64(ad),
  };
}

// --- Senden / Empfangen ---------------------------------------------------------

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
): { state: RatchetState; message: RatchetMessage } {
  if (!state.cks) {
    throw new Error('Ratchet: Sendekette existiert noch nicht (erst Nachricht empfangen)');
  }
  const s = sodium();
  const { messageKey, nextChainKey } = kdfChainKey(fromB64(state.cks));
  const header: RatchetHeader = { dh: state.dhsPublic, pn: state.pn, n: state.ns };
  const nonce = s.randombytes_buf(s.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ad = concatBytes(fromB64(state.ad), headerBytes(header));
  const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    ad,
    null,
    nonce,
    messageKey,
  );
  return {
    state: { ...state, cks: toB64(nextChainKey), ns: state.ns + 1 },
    message: { header, nonce: toB64(nonce), ciphertext: toB64(ciphertext) },
  };
}

export function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage,
): { state: RatchetState; plaintext: Uint8Array } {
  const { header } = message;

  // 1) Nachricht aus einer bereits übersprungenen Position?
  const skippedKey = `${header.dh}:${header.n}`;
  if (state.skipped[skippedKey]) {
    const plaintext = aeadOpen(state, message, fromB64(state.skipped[skippedKey]));
    const skipped = { ...state.skipped };
    delete skipped[skippedKey];
    return { state: { ...state, skipped }, plaintext };
  }

  let working: RatchetState = { ...state, skipped: { ...state.skipped } };

  // 2) Neuer Ratchet-Key der Gegenseite → Restschlüssel der alten Kette
  //    aufheben, dann DH-Ratchet-Schritt.
  if (header.dh !== working.dhr) {
    working = skipMessageKeys(working, header.pn);
    working = dhRatchetStep(working, header.dh);
  }

  // 3) Innerhalb der aktuellen Kette bis zur Nachricht vorspulen.
  working = skipMessageKeys(working, header.n);
  if (!working.ckr) throw new Error('Ratchet: Empfangskette fehlt');
  const { messageKey, nextChainKey } = kdfChainKey(fromB64(working.ckr));
  const plaintext = aeadOpen(working, message, messageKey); // wirft bei Manipulation
  return {
    state: { ...working, ckr: toB64(nextChainKey), nr: working.nr + 1 },
    plaintext,
  };
}

function aeadOpen(state: RatchetState, message: RatchetMessage, key: Uint8Array): Uint8Array {
  const s = sodium();
  const ad = concatBytes(fromB64(state.ad), headerBytes(message.header));
  return s.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    fromB64(message.ciphertext),
    ad,
    fromB64(message.nonce),
    key,
  );
}

function skipMessageKeys(state: RatchetState, until: number): RatchetState {
  if (!state.ckr) {
    if (until > 0) throw new Error('Ratchet: kann ohne Empfangskette nicht überspringen');
    return state;
  }
  if (state.nr + MAX_SKIP < until) {
    throw new Error(`Ratchet: zu viele übersprungene Nachrichten (${until - state.nr})`);
  }
  let ckr = fromB64(state.ckr);
  const skipped = { ...state.skipped };
  let nr = state.nr;
  while (nr < until) {
    const { messageKey, nextChainKey } = kdfChainKey(ckr);
    skipped[`${state.dhr}:${nr}`] = toB64(messageKey);
    ckr = nextChainKey;
    nr++;
  }
  return { ...state, ckr: toB64(ckr), nr, skipped };
}

function dhRatchetStep(state: RatchetState, theirNewDh: string): RatchetState {
  const s = sodium();
  const dhrBytes = fromB64(theirNewDh);

  // Empfangskette aus dem alten eigenen Schlüsselpaar ableiten …
  const recvOut = s.crypto_scalarmult(fromB64(state.dhsPrivate), dhrBytes);
  const [rootKey1, ckr] = kdfRootKey(fromB64(state.rootKey), recvOut);

  // … dann neues eigenes Paar erzeugen und die Sendekette neu aufsetzen.
  const newDhs = s.crypto_box_keypair();
  const sendOut = s.crypto_scalarmult(newDhs.privateKey, dhrBytes);
  const [rootKey2, cks] = kdfRootKey(rootKey1, sendOut);

  return {
    ...state,
    rootKey: toB64(rootKey2),
    dhsPublic: toB64(newDhs.publicKey),
    dhsPrivate: toB64(newDhs.privateKey),
    dhr: theirNewDh,
    ckr: toB64(ckr),
    cks: toB64(cks),
    pn: state.ns,
    ns: 0,
    nr: 0,
  };
}
