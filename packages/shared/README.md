# @parley/shared

Gemeinsame Typen und Utilities für alle Parley-Apps (`apps/api`, `apps/web`, später `apps/voice`).

Hier landen im Projektverlauf:

- API-Antwort-Typen (aktuell: `HealthStatus`)
- Opcode-Definitionen für das WebSocket-Gateway (ab Phase 2)
- Krypto-Utilities auf libsodium-Basis (seit Phase 6, `src/crypto/`)

## Krypto-Bausteine (`src/crypto/`)

Ausschließlich geprüfte libsodium-Primitiven, keine eigenen Algorithmen:

- `keys.ts` – Ed25519-Identität + signierter X25519-Prekey (Signal-Prinzip: ein Identitätsschlüssel für Signatur UND DH via Konvertierung)
- `x3dh.ts` – X3DH-Schlüsselvereinbarung nach der öffentlichen Signal-Spezifikation (Fallback-Modus ohne One-Time-Prekeys)
- `ratchet.ts` – Double Ratchet (BLAKE2b-KDF-Ketten, XChaCha20-Poly1305, Header als Associated Data); alle Funktionen pure – Zustand wird erst nach Erfolg persistiert
- `senderkey.ts` – Sender-Key-Ratchet für Kanäle (Megolm-Prinzip): vorwärts ratchende Kette + Ed25519-Signatur gegen Fälschung durch Mit-Mitglieder; Entschlüsseln ist idempotent (frühester Stand + Vorspulen)
- `envelope.ts` – Wire-Format der Schlüssel-Umschläge (Sender-Key-Verteilung über 1:1-Sessions)
- `file.ts` – Datei-Verschlüsselung für Anhänge (Phase 8): XChaCha20-Poly1305 mit frischem Zufallsschlüssel pro Datei; Schlüssel/Nonce wandern im E2EE-Nachrichtentext (`MessageContentV1` in `src/messages.ts`), nie zum Server

Tests: `npm run test -w @parley/shared` (Vitest, `src/crypto/crypto.spec.ts`).

## Build

```bash
npm run build -w @parley/shared
```

Kompiliert nach `dist/` (CommonJS + Typdeklarationen). Die anderen Workspaces konsumieren den Build-Output, daher muss dieses Paket vor `@parley/api` gebaut werden – das Root-Skript `npm run build` beachtet die Reihenfolge bereits.
