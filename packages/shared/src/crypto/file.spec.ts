import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from './sodium';
import { decryptFileBytes, encryptFileBytes } from './file';
import { decodeMessageContent, encodeMessageContent } from '../messages';

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

describe('Nachrichten-Inhaltsformat (Phase 8)', () => {
  it('kodiert und dekodiert Text mit Anhängen', () => {
    const meta = {
      id: 'a1',
      name: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      key: 'k',
      nonce: 'n',
    };
    const decoded = decodeMessageContent(encodeMessageContent('hallo', [meta]));
    expect(decoded.text).toBe('hallo');
    expect(decoded.attachments).toEqual([meta]);
  });

  it('behandelt Nachrichten aus Phase 6/7 (Rohtext) als Text ohne Anhänge', () => {
    expect(decodeMessageContent('einfach nur Text')).toEqual({
      text: 'einfach nur Text',
      attachments: [],
    });
    // Auch krumme JSON-ähnliche Texte fallen sauber auf Rohtext zurück.
    expect(decodeMessageContent('{kein json')).toEqual({ text: '{kein json', attachments: [] });
    expect(decodeMessageContent('{"v":2,"x":1}')).toEqual({
      text: '{"v":2,"x":1}',
      attachments: [],
    });
  });
});
