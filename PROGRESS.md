# PROGRESS – Projektstand

> Diese Datei wird am Ende jeder Phase aktualisiert. Neue Session? Zuerst hier lesen, dann [CLAUDE.md](CLAUDE.md) für den Gesamtauftrag.

## Status: Phase 1 abgeschlossen (05.07.2026)

## Erledigt

### Phase 0 – Setup (05.07.2026)

- Monorepo mit npm-Workspaces: `apps/api` (NestJS 11), `apps/web` (React 19 + Vite + Tailwind 4), `packages/shared` (gemeinsame Typen, CJS-Build)
- Tooling: TypeScript strict (gemeinsame `tsconfig.base.json`), ESLint 9 (Flat Config) + Prettier auf Root-Ebene
- `infra/docker-compose.yml` mit PostgreSQL 16, Redis 7, MinIO (inkl. Healthchecks, Volumes, `.env`-Anbindung)
- API: `GET /api/health` liefert `HealthStatus` (Typ aus `@parley/shared`)
- Web: Statusseite, die `/api/health` über den Vite-Proxy abruft (kein CORS nötig)
- Git-Repo initialisiert (Branch `main`), Commit `dca9dfa`
- Node.js 22 portabel installiert nach `%LOCALAPPDATA%\Programs\nodejs` und in den Benutzer-PATH eingetragen (kein Admin nötig)
- **Nachverifiziert in Session 2:** Docker Desktop wurde installiert, `docker compose up` läuft – alle drei Container healthy

### Phase 1 – Auth & Nutzerverwaltung (05.07.2026)

- **Prisma** angebunden (Schema in `apps/api/prisma/schema.prisma`, Migration `init`): Modelle `User` und `RefreshToken`; Root-Skripte `prisma:generate` / `prisma:migrate`
- **Registrierung & Login** (`POST /api/auth/register|login`): Argon2id-Hashing (OWASP-Parameter: 19 MiB, t=2, p=1), generische Fehlermeldung gegen User-Enumeration
- **Token-Konzept:** Access-Token = JWT (15 min, nur im Speicher des Clients); Refresh-Token = opakes 256-Bit-Token im httpOnly-Cookie (Pfad `/api/auth`, 30 Tage), in der DB nur als SHA-256-Hash
- **Rotation + Diebstahl-Erkennung:** Jeder Refresh entwertet das alte Token; Wiederverwendung nach 60-s-Karenzzeit beendet alle Sessions des Nutzers. Karenzzeit nötig wegen paralleler Refreshes (mehrere Tabs / React StrictMode) – ohne sie loggt sich die App bei jedem Reload selbst aus (in dieser Phase als echter Bug gefunden und behoben)
- **Profil:** `GET/PATCH /api/users/me` (AuthGuard, Bearer-JWT), Status-Text + Avatar-URL änderbar
- **Frontend:** Zustand-Store mit Single-Flight-Refresh und automatischem Retry bei 401, Login-/Registrierungs-Seite, Profilseite mit Status-Bearbeitung und Logout
- **Vitest** eingerichtet (`apps/api`, Root-Skript `npm test`), Unit-Tests für Token-Utilities
- `.env` im Root angelegt (JWT_SECRET generiert), `.env.example` erweitert

**Verifiziert (Ende-zu-Ende über die UI):** Registrieren → Profilseite; Status speichern → übersteht Reload; Session-Restore nach Reload; Logout → zurück zum Login; falsches Passwort → generische Fehlermeldung; korrektes Login → Profil. In der DB: nur `$argon2id$…`-Hashes, Refresh-Tokens nur als Hash, nach Logout alle widerrufen. Build/Tests/Lint/Format grün.

## Nächste Phase

**Phase 2 – Echtzeit-Gateway:** WebSocket-Verbindung mit eigenem Opcode-Protokoll, Heartbeat, Redis-Pub/Sub für Multi-Instanz-Betrieb, Online-Status. Verifikation: Zwei Tabs sehen sich gegenseitig als online.

## Notizen für kommende Sessions

- Projektname „Parley“ ist nur Arbeitstitel (siehe ROADMAP.md)
- Node ist NICHT systemweit installiert – falls `node` im PATH fehlt: `%LOCALAPPDATA%\Programs\nodejs`
- Server starten: Preview-Panel-Konfigurationen `api`/`web` (nutzen `scripts/dev-*.cmd`) oder `npm run dev:api` / `npm run dev:web`
- Infrastruktur: `docker compose -f infra/docker-compose.yml up -d` (Docker Desktop muss laufen)
- Testnutzer in der Dev-DB: `arian.test@example.com` / `test-passwort-123`
