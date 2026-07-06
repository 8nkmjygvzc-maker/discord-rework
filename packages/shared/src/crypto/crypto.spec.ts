import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady, utf8ToBytes, bytesToUtf8, toB64 } from './sodium';
import { generateIdentityKeyPair, generateSignedPreKey, verifySignedPreKey } from './keys';
import { x3dhInitiate, x3dhRespond } from './x3dh';
import {
  ratchetDecrypt,
  ratchetEncrypt,
  ratchetInitAsInitiator,
  ratchetInitAsResponder,
  RatchetState,
} from './ratchet';
import {
  createSenderKey,
  decryptChannelMessage,
  encryptChannelMessage,
  senderKeyDistribution,
} from './senderkey';

beforeAll(async () => {
  await cryptoReady();
});

/** Baut ein komplettes Sessionpaar Alice (Initiator) ↔ Bob (Responder). */
function makeSessionPair(): { alice: RatchetState; bob: RatchetState } {
  const aliceId = generateIdentityKeyPair();
  const bobId = generateIdentityKeyPair();
  const bobSpk = generateSignedPreKey(bobId);
  const bundle = {
    userId: 'bob',
    identityKey: bobId.signPublicKey,
    signedPreKey: bobSpk.publicKey,
    signedPreKeySignature: bobSpk.signature,
  };
  const { sharedSecret, header } = x3dhInitiate(aliceId, bundle);
  const ad = utf8ToBytes(aliceId.signPublicKey + bobId.signPublicKey);
  const alice = ratchetInitAsInitiator(sharedSecret, bobSpk.publicKey, ad);
  const bobSecret = x3dhRespond(bobId, bobSpk, header);
  const bob = ratchetInitAsResponder(bobSecret, bobSpk, ad);
  return { alice, bob };
}

describe('Schlüssel & X3DH', () => {
  it('Prekey-Signatur verifiziert nur mit passendem Identitätsschlüssel', () => {
    const id = generateIdentityKeyPair();
    const spk = generateSignedPreKey(id);
    const bundle = {
      userId: 'u',
      identityKey: id.signPublicKey,
      signedPreKey: spk.publicKey,
      signedPreKeySignature: spk.signature,
    };
    expect(verifySignedPreKey(bundle)).toBe(true);
    const fremd = generateIdentityKeyPair();
    expect(verifySignedPreKey({ ...bundle, identityKey: fremd.signPublicKey })).toBe(false);
  });

  it('beide Seiten leiten dasselbe Shared Secret ab', () => {
    const aliceId = generateIdentityKeyPair();
    const bobId = generateIdentityKeyPair();
    const bobSpk = generateSignedPreKey(bobId);
    const { sharedSecret, header } = x3dhInitiate(aliceId, {
      userId: 'bob',
      identityKey: bobId.signPublicKey,
      signedPreKey: bobSpk.publicKey,
      signedPreKeySignature: bobSpk.signature,
    });
    const bobSecret = x3dhRespond(bobId, bobSpk, header);
    expect(toB64(sharedSecret)).toBe(toB64(bobSecret));
    expect(sharedSecret.length).toBe(32);
  });

  it('manipuliertes Bundle wird abgelehnt', () => {
    const aliceId = generateIdentityKeyPair();
    const bobId = generateIdentityKeyPair();
    const evilSpk = generateSignedPreKey(generateIdentityKeyPair());
    expect(() =>
      x3dhInitiate(aliceId, {
        userId: 'bob',
        identityKey: bobId.signPublicKey,
        signedPreKey: evilSpk.publicKey, // ausgetauschter Prekey
        signedPreKeySignature: evilSpk.signature,
      }),
    ).toThrow(/Signatur/);
  });
});

describe('Double Ratchet', () => {
  it('Ping-Pong in beide Richtungen', () => {
    let { alice, bob } = makeSessionPair();

    const m1 = ratchetEncrypt(alice, utf8ToBytes('Hallo Bob'));
    alice = m1.state;
    const r1 = ratchetDecrypt(bob, m1.message);
    bob = r1.state;
    expect(bytesToUtf8(r1.plaintext)).toBe('Hallo Bob');

    const m2 = ratchetEncrypt(bob, utf8ToBytes('Hallo Alice'));
    bob = m2.state;
    const r2 = ratchetDecrypt(alice, m2.message);
    alice = r2.state;
    expect(bytesToUtf8(r2.plaintext)).toBe('Hallo Alice');

    // Und noch eine Runde, damit beide DH-Ratchet-Schritte durchlaufen sind.
    const m3 = ratchetEncrypt(alice, utf8ToBytes('Runde 2'));
    expect(bytesToUtf8(ratchetDecrypt(bob, m3.message).plaintext)).toBe('Runde 2');
  });

  it('Out-of-Order-Zustellung über Skipped Keys', () => {
    const pair = makeSessionPair();
    const alice = pair.alice;
    let bob = pair.bob;
    const m1 = ratchetEncrypt(alice, utf8ToBytes('eins'));
    const m2 = ratchetEncrypt(m1.state, utf8ToBytes('zwei'));
    const m3 = ratchetEncrypt(m2.state, utf8ToBytes('drei'));

    // 3 zuerst, dann 1, dann 2
    const r3 = ratchetDecrypt(bob, m3.message);
    bob = r3.state;
    expect(bytesToUtf8(r3.plaintext)).toBe('drei');
    const r1 = ratchetDecrypt(bob, m1.message);
    bob = r1.state;
    expect(bytesToUtf8(r1.plaintext)).toBe('eins');
    const r2 = ratchetDecrypt(bob, m2.message);
    expect(bytesToUtf8(r2.plaintext)).toBe('zwei');
  });

  it('manipulierter Ciphertext wirft und lässt den Zustand unangetastet', () => {
    const { alice, bob } = makeSessionPair();
    const m = ratchetEncrypt(alice, utf8ToBytes('geheim'));
    const kaputt = {
      ...m.message,
      ciphertext: m.message.ciphertext.slice(0, -4) + 'AAAA',
    };
    expect(() => ratchetDecrypt(bob, kaputt)).toThrow();
    // Original ist danach weiterhin entschlüsselbar (bob wurde nicht mutiert).
    expect(bytesToUtf8(ratchetDecrypt(bob, m.message).plaintext)).toBe('geheim');
  });

  it('jede Nachricht nutzt einen neuen Message Key (Forward Secrecy der Kette)', () => {
    const { alice } = makeSessionPair();
    const m1 = ratchetEncrypt(alice, utf8ToBytes('a'));
    const m2 = ratchetEncrypt(m1.state, utf8ToBytes('a'));
    expect(m1.message.ciphertext).not.toBe(m2.message.ciphertext);
    expect(m1.state.cks).not.toBe(alice.cks);
  });
});

describe('Sender-Key-Ratchet (Kanäle)', () => {
  it('Verteilung + mehrere Nachrichten, auch out-of-order lesbar', () => {
    let own = createSenderKey();
    const dist = senderKeyDistribution(own, 'kanal-1');
    const recv = { ...dist }; // Empfänger speichert den frühesten Stand

    const e1 = encryptChannelMessage(own, 'kanal-1', 'erste');
    own = e1.key;
    const e2 = encryptChannelMessage(own, 'kanal-1', 'zweite');
    own = e2.key;
    const e3 = encryptChannelMessage(own, 'kanal-1', 'dritte');

    // Reihenfolge egal, Zustand bleibt unverändert (idempotent).
    expect(decryptChannelMessage(recv, 'kanal-1', e3.message)).toBe('dritte');
    expect(decryptChannelMessage(recv, 'kanal-1', e1.message)).toBe('erste');
    expect(decryptChannelMessage(recv, 'kanal-1', e2.message)).toBe('zweite');
    expect(decryptChannelMessage(recv, 'kanal-1', e2.message)).toBe('zweite');
  });

  it('Nachrichten vor dem verteilten Stand bleiben unlesbar (Beitritts-Semantik)', () => {
    let own = createSenderKey();
    const early = encryptChannelMessage(own, 'kanal-1', 'vor dem Beitritt');
    own = early.key;
    // Verteilung erst NACH der ersten Nachricht (Iteration 1)
    const recv = { ...senderKeyDistribution(own, 'kanal-1') };
    expect(() => decryptChannelMessage(recv, 'kanal-1', early.message)).toThrow(/vor dem/);
    const later = encryptChannelMessage(own, 'kanal-1', 'nach dem Beitritt');
    expect(decryptChannelMessage(recv, 'kanal-1', later.message)).toBe('nach dem Beitritt');
  });

  it('gefälschte Signatur und falscher Kanal (AD) werden abgelehnt', () => {
    const own = createSenderKey();
    const recv = { ...senderKeyDistribution(own, 'kanal-1') };
    const e = encryptChannelMessage(own, 'kanal-1', 'echt');

    // Anderes Mitglied kennt den symmetrischen Schlüssel, aber nicht den
    // Signaturschlüssel → Fälschungsversuch scheitert an der Signatur.
    const forger = { ...createSenderKey(), keyId: own.keyId, chainKey: own.chainKey };
    const forged = encryptChannelMessage(forger, 'kanal-1', 'fake');
    expect(() => decryptChannelMessage(recv, 'kanal-1', forged.message)).toThrow(/Signatur/);

    // Associated Data bindet die Kanal-ID: Replay in anderem Kanal scheitert.
    expect(() => decryptChannelMessage(recv, 'kanal-2', e.message)).toThrow();
  });
});
