/**
 * Zentraler libsodium-Zugriff. libsodium initialisiert sich asynchron (WASM);
 * alle Krypto-Funktionen dieses Pakets setzen voraus, dass `cryptoReady()`
 * einmal abgewartet wurde – danach sind sie synchron nutzbar.
 */
import _sodium from 'libsodium-wrappers';

let ready = false;

export async function cryptoReady(): Promise<void> {
  await _sodium.ready;
  ready = true;
}

/** Liefert die initialisierte libsodium-Instanz (wirft vor `cryptoReady()`). */
export function sodium(): typeof _sodium {
  if (!ready) {
    throw new Error('libsodium ist nicht initialisiert – zuerst cryptoReady() abwarten');
  }
  return _sodium;
}

// --- Base64-Helfer (URL-safe ohne Padding, überall einheitlich) --------------

export function toB64(bytes: Uint8Array): string {
  return sodium().to_base64(bytes, _sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function fromB64(value: string): Uint8Array {
  return sodium().from_base64(value, _sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function utf8ToBytes(value: string): Uint8Array {
  return sodium().from_string(value);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return sodium().to_string(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
