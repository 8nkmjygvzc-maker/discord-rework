import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from './sodium';
import { decryptFileBytes, encryptFileBytes } from './file';

beforeAll(() => cryptoReady());

describe('Datei-Verschlüsselung (Phase 8)', () => {
  it('ver- und entschlüsselt Bytes verlustfrei', () => {
    const plain = new Uint8Array(1024).map((_, i) => i % 251);
    const enc = encryptFileBytes(plain);
    expect(enc.ciphertext).not.toEqual(plain);
    expect(enc.ciphertext.length).toBe(plain.length + 16); // AEAD-Tag
    const dec = decryptFileBytes(enc.key, enc.nonce, enc.ciphertext);
    expect(dec).toEqual(plain);
  });

  it('erzeugt pro Datei frische Schlüssel und Nonces', () => {
    const plain = new Uint8Array([1, 2, 3]);
    const a = encryptFileBytes(plain);
    const b = encryptFileBytes(plain);
    expect(a.key).not.toBe(b.key);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('wirft bei manipuliertem Ciphertext', () => {
    const enc = encryptFileBytes(new Uint8Array([9, 9, 9, 9]));
    enc.ciphertext[0] ^= 0xff;
    expect(() => decryptFileBytes(enc.key, enc.nonce, enc.ciphertext)).toThrow();
  });
});

// Tests zum Nachrichten-Inhaltsformat liegen seit Phase 9 in src/messages.spec.ts.
