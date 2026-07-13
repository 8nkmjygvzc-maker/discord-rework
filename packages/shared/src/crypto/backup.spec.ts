import { beforeAll, describe, expect, it } from 'vitest';
import { cryptoReady } from './sodium';
import {
  backupKdfDefaults,
  decryptBackupBlob,
  deriveBackupKek,
  encryptBackupBlob,
  generateBackupMasterKey,
  generateBackupSalt,
  unwrapBackupMasterKey,
  wrapBackupMasterKey,
} from './backup';

beforeAll(() => cryptoReady());

// Argon2id mit den echten INTERACTIVE-Parametern (64 MiB) läuft auch im Test –
// die Ableitung ist bewusst teuer, deshalb wird sie hier nur einmal gemacht.
describe('Schlüssel-Backup', () => {
  it('wrap/unwrap-Roundtrip mit passwortabgeleitetem KEK', () => {
    const { opsLimit, memLimit } = backupKdfDefaults();
    const salt = generateBackupSalt();
    const masterKey = generateBackupMasterKey();

    const kek = deriveBackupKek('korrektes passwort', salt, opsLimit, memLimit);
    const wrapped = wrapBackupMasterKey(masterKey, kek);
    expect(unwrapBackupMasterKey(wrapped, kek)).toBe(masterKey);

    // Falsches Passwort → anderer KEK → Entpacken schlägt fehl.
    const wrongKek = deriveBackupKek('falsches passwort', salt, opsLimit, memLimit);
    expect(() => unwrapBackupMasterKey(wrapped, wrongKek)).toThrow();

    // Ableitung ist deterministisch (gleiches Passwort + Salt + Parameter).
    const again = deriveBackupKek('korrektes passwort', salt, opsLimit, memLimit);
    expect(Buffer.from(again).toString('hex')).toBe(Buffer.from(kek).toString('hex'));
  });

  it('Blob-Roundtrip; AD bindet die User-ID; Manipulation fliegt auf', () => {
    const masterKey = generateBackupMasterKey();
    const state = JSON.stringify({ v: 1, identity: { signPublicKey: 'abc' } });

    const box = encryptBackupBlob(masterKey, state, 'user-1');
    expect(box.ciphertext).not.toContain('signPublicKey');
    expect(decryptBackupBlob(masterKey, box, 'user-1')).toBe(state);

    // Blob eines anderen Kontos (bzw. vertauschtes AD) wird abgelehnt.
    expect(() => decryptBackupBlob(masterKey, box, 'user-2')).toThrow();
    // Fremder/falscher Master-Key wird abgelehnt.
    expect(() => decryptBackupBlob(generateBackupMasterKey(), box, 'user-1')).toThrow();
    // Manipulierter Ciphertext wird abgelehnt.
    const tampered = { ...box, ciphertext: box.ciphertext.slice(0, -2) + 'AA' };
    expect(() => decryptBackupBlob(masterKey, tampered, 'user-1')).toThrow();
  });

  it('erzeugt pro Aufruf frische Nonces (kein Nonce-Reuse beim Sync)', () => {
    const masterKey = generateBackupMasterKey();
    const a = encryptBackupBlob(masterKey, '{}', 'u');
    const b = encryptBackupBlob(masterKey, '{}', 'u');
    expect(a.nonce).not.toBe(b.nonce);
  });
});
