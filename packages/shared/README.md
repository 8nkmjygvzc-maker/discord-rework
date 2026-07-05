# @parley/shared

Gemeinsame Typen und Utilities für alle Parley-Apps (`apps/api`, `apps/web`, später `apps/voice`).

Hier landen im Projektverlauf:

- API-Antwort-Typen (aktuell: `HealthStatus`)
- Opcode-Definitionen für das WebSocket-Gateway (ab Phase 2)
- Krypto-Utilities auf libsodium-Basis (ab Phase 6)

## Build

```bash
npm run build -w @parley/shared
```

Kompiliert nach `dist/` (CommonJS + Typdeklarationen). Die anderen Workspaces konsumieren den Build-Output, daher muss dieses Paket vor `@parley/api` gebaut werden – das Root-Skript `npm run build` beachtet die Reihenfolge bereits.
