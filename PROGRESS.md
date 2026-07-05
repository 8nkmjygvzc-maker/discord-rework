# PROGRESS – Projektstand

> Diese Datei wird am Ende jeder Phase aktualisiert. Neue Session? Zuerst hier lesen, dann [CLAUDE.md](CLAUDE.md) für den Gesamtauftrag.

## Status: Phase 3 abgeschlossen (05.07.2026)

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

### Phase 2 – Echtzeit-Gateway (05.07.2026)

- **Eigenes Opcode-Protokoll** in `packages/shared/src/gateway.ts`: HELLO → IDENTIFY (JWT) → READY → HEARTBEAT/ACK, Dispatch-Events (`READY`, `PRESENCE_UPDATE`), definierte Close-Codes (4001–4004)
- **Gateway-Server** (`apps/api/src/gateway/`): natives `ws` am selben HTTP-Server (Pfad `/gateway`), Identify-Timeout 10 s, Heartbeat-Intervall 15 s mit 2×-Toleranz, Payload-Limit 64 KiB
- **Presence in Redis** (`presence:conn:{userId}`-Zähler mit 60-s-TTL als Totmann-Schalter + `presence:users`-Hash); mehrere Tabs = ein Nutzer online; Leichen werden beim Snapshot lazy aufgeräumt
- **Multi-Instanz-fähig:** alle Events laufen über Redis-Pub/Sub (`gateway:dispatch`), auch für die eigene Instanz – ein Codepfad für 1..N Gateways
- **Rate-Limiting** (aus ROADMAP nachgezogen): `RateLimitGuard` (Redis, Fixed Window, pro IP) auf register (10/5 min), login (10/min), refresh (60/min)
- **Frontend:** `GatewayClient` (Reconnect mit exponentiellem Backoff, Heartbeat-Überwachung, Token-Refresh bei Close 4001), Presence-Store (Zustand), Online-Panel auf der Profilseite, `/gateway`-WS-Proxy in Vite
- **Vite-Alias** `@parley/shared` → TS-Quelle (Rollup kann CJS-Enum-Re-Exports nicht auflösen)

**Verifiziert:** Protokoll-Test-Skript (2 Nutzer: READY-Snapshot, gegenseitige PRESENCE_UPDATEs online/offline, HEARTBEAT_ACK, Close 4001 bei ungültigem Token) – alle Checks grün. UI-Test im Browser: „Gerade online“-Panel zeigt zweiten Nutzer in Echtzeit beim Verbinden/Trennen. Rate-Limit: 12 Login-Versuche → 2× HTTP 429. Build/Tests/Lint grün.

### Phase 3 – Server & Kanäle (05.07.2026)

- **Prisma:** Modelle `Server`, `Membership` (Composite-Key userId+serverId), `Channel` (+ `ChannelType`-Enum, serverId nullable für DMs ab Phase 7); Migration `servers_channels`
- **REST** (`apps/api/src/servers/`): Server-CRUD, Beitritt per Server-ID (Invites folgen Phase 12), verlassen (Owner gesperrt), Kanal-CRUD; Verwaltung bis Phase 5 Owner-only; 404 statt 403 für Nicht-Mitglieder (kein Existenz-Leak), 409 bei Doppel-Beitritt
- **Gateway erweitert:** `publishDispatch(t, d, targetUserIds?)` – Events gehen gezielt an Server-Mitglieder (`SERVER_UPDATE/DELETE`, `SERVER_MEMBER_ADD/REMOVE`, `CHANNEL_CREATE/UPDATE/DELETE`)
- **Frontend:** Discord-artiges Layout (Server-Leiste → Kanal-Sidebar → Hauptbereich → Mitglieder-Panel), Server/Kanal-Dialoge, „ID kopieren“-Button zum Einladen, Mitglieder-Panel mit Live-Online-Status, Profil als Unteransicht (⚙ → Zurück); `GatewayClient` mit generischem `onDispatch`, Store-Verdrahtung in `lib/gatewayConnection.ts`; nach Reconnect wird der REST-Stand neu geladen (verpasste Events)

**Verifiziert:** UI: Server „Arians Treffpunkt“ + Kanal „projekte“ angelegt; frieda tritt per ID bei und erscheint OHNE Reload im Mitglieder-Panel (SERVER_MEMBER_ADD). API: Details vor Beitritt 404, Beitritt 201, Doppel-Beitritt 409, Kanal anlegen als Nicht-Owner 403, Server löschen als Nicht-Owner 403 – serverseitig durchgesetzt. Build/Tests/Lint grün.

## Nächste Phase

**Phase 4 – Basis-Text-Chat (noch unverschlüsselt):** Nachrichten senden/empfangen/History über Gateway + REST, bewusst Klartext zur Pipeline-Verifikation. Verifikation: Nachricht kommt in Echtzeit bei allen Mitgliedern an, History lädt nach Reload.

## Dev-Umgebung (Stand Session 3, 05.07.2026)

Diese Maschine war frisch aufgesetzt (kein Node, kein Docker, WSL defekt). Docker Desktop braucht Admin + WSL → stattdessen läuft die Infrastruktur **portabel ohne Admin-Rechte**:

- **Node 22.23.1** portabel: `%LOCALAPPDATA%\Programs\nodejs` (im Benutzer-PATH)
- **PostgreSQL 16.6** (EnterpriseDB-Binaries): `%LOCALAPPDATA%\Programs\parley-infra\pgsql`, Datenverzeichnis `%LOCALAPPDATA%\parley-data\pgdata`, User/PW/DB wie in `.env`
- **Redis 5.0.14** (tporadowski-Windows-Port): `%LOCALAPPDATA%\Programs\parley-infra\redis`
- **MinIO**: `%LOCALAPPDATA%\Programs\parley-infra\minio.exe`
- **Alles starten:** `powershell -ExecutionPolicy Bypass -File scripts\dev-infra.ps1` (startet nur, was nicht schon läuft)
- `.env` wurde neu erzeugt (frisches `JWT_SECRET`), Migrationen mit `prisma migrate deploy` eingespielt

## Notizen für kommende Sessions

- Projektname „Parley“ ist nur Arbeitstitel (siehe ROADMAP.md)
- Node ist NICHT systemweit installiert – falls `node` im PATH fehlt: `%LOCALAPPDATA%\Programs\nodejs`
- Server starten: Preview-Panel-Konfigurationen `api`/`web` (`.claude/launch.json`, nutzen `scripts/dev-*.cmd`) oder `npm run dev:api` / `npm run dev:web`
- Infrastruktur: `scripts\dev-infra.ps1` (portabel) oder `docker compose -f infra/docker-compose.yml up -d` (falls Docker vorhanden)
- Testnutzer in der Dev-DB (frisch angelegt in Session 3): `arian.test@example.com` und `frieda.test@example.com`, Passwort jeweils `test-passwort-123`
