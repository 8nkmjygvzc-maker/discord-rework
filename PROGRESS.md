# PROGRESS – Projektstand

> Diese Datei wird am Ende jeder Phase aktualisiert. Neue Session? Zuerst hier lesen, dann [CLAUDE.md](CLAUDE.md) für den Gesamtauftrag.

## Status: Phase 7 abgeschlossen (07.07.2026)

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

### Phase 4 – Basis-Text-Chat, unverschlüsselt (05.07.2026)

- **Prisma:** `Message` (content als Klartext – wird in Phase 6 durch ciphertext+nonce ersetzt), Index `(channelId, createdAt)`; Migration `messages`
- **REST** (`apps/api/src/messages/`): `POST/GET /api/channels/:id/messages`; History rückwärts paginiert (50er-Seiten, `before`-Cursor, `hasMore` über N+1-Trick); Zugriff nur für Server-Mitglieder in TEXT-Kanälen (404 statt 403); Senden rate-limitiert (30/30 s)
- **Gateway:** `MESSAGE_CREATE` an alle Server-Mitglieder
- **Frontend:** `ChatView` (Verlauf mit „Ältere laden“, Gruppierung aufeinanderfolgender Nachrichten, Auto-Scroll nur wenn unten, Fehleranzeige mit Draft-Erhalt), Messages-Store mit Dedupe (REST-Antwort vs. Gateway-Event)

**Verifiziert:** arian (UI) ↔ frieda (Skript am Gateway): Nachrichten kommen in beide Richtungen live an; History übersteht Reload; Nicht-Mitglied bekommt 404 auf Lesen UND Senden (serverseitig). Build/Lint grün.

### Phase 5 – Rollen & Berechtigungen (06.07.2026)

Die Implementierung kam als Commit `39b9ec7` („initial commit rijon“) von Rijon; diese Session hat den Code reviewt, Lücken geschlossen und die Phase verifiziert.

- **Bitfield** in `packages/shared/src/permissions.ts`: BigInt (über JSON als Dezimal-String), 9 Rechte (ViewChannels, SendMessages, ManageChannels, ManageRoles, ManageServer, Kick/Ban, ManageMessages, Administrator); unbekannte Bits werden beim Schreiben maskiert
- **Standardrolle „Mitglied“** (isDefault, View|Send) pro Server, gilt implizit für alle Mitglieder – nicht löschbar/zuweisbar, Name fix; Backfill-Migration versorgt Bestands-Server
- **Effektive Rechte:** Owner → Administrator; sonst Standardrolle ∪ zugewiesene Rollen (Bit-OR). Zentral im `PermissionsService`: 404 für Nicht-Mitglieder (kein Existenz-Leak), 403 bei fehlendem Recht – in jedem Endpunkt serverseitig
- **REST:** Rollen-CRUD + Zuweisung (`PUT/DELETE /servers/:id/members/:userId/roles/:roleId`) unter ManageRoles; bestehende Endpunkte umgestellt (Server-PATCH → ManageServer, Kanal-CRUD → ManageChannels, Senden → SendMessages, History → ViewChannels); Server-DELETE bleibt Owner-only
- **Gateway:** `ROLE_CREATE/UPDATE/DELETE`, `MEMBER_ROLES_UPDATE`. **Review-Fix:** `MESSAGE_CREATE` geht nur noch an Mitglieder mit ViewChannels (`getMemberIdsWithPermission`) – vorher hätte das Gateway live zugestellt, obwohl die REST-History gesperrt war
- **Frontend:** `RolesDialog` (anlegen, Rechte togglen, zuweisen, löschen), Rollen-Badges im Mitglieder-Panel, `myPermissions` in `ServerDetails`; UI blendet nur aus (Kanal-+, Rollen-Button, Eingabefeld). Review-Fix: `PUT` fehlte im Methoden-Typ von `authFetch`
- **Nebenbei repariert:** `node_modules` unvollständig + Prisma-Client veraltet (npm install, prisma generate), 3 nicht eingespielte Migrationen deployed; `.gitattributes` erzwingt jetzt LF (der frische Checkout mit `core.autocrlf=true` hatte alle Dateien auf CRLF gestellt → Prettier schlug überall fehl), Working Tree auf LF normalisiert

**Verifiziert:** Skript mit 33 Checks, alle grün – Kerntest: Senden ohne Schreibrecht → **403 vom Server**; 404 statt 403 für Nicht-Mitglieder; alle Verwaltungs-Endpunkte ohne Recht 403; Rollenzuweisung schaltet Rechte frei, Entzug sperrt wieder; Gateway liefert `MESSAGE_CREATE` nur mit ViewChannels (mit und ohne getestet); Standardrolle geschützt (Löschen/Zuweisen → 400, Name unveränderbar); unbekannte Bits maskiert. UI: Rollen-Dialog geprüft (Rolle angelegt, Recht getoggelt – Zustand kommt über ROLE_UPDATE-Event zurück). Build/Tests/Lint/Format grün.

### Phase 6 – Ende-zu-Ende-Verschlüsselung (06.07.2026)

Wie Phase 5 kam die Implementierung als angelieferter Commit (`3a38c88`); diese Session hat den Krypto-Code reviewt, vier Lücken geschlossen und die Phase verifiziert.

- **Krypto-Bausteine** in `packages/shared/src/crypto/` (nur libsodium-Primitiven, 10 Unit-Tests):
  - Identität = Ed25519 (signieren) + Konvertierung nach X25519 (DH), signierter Prekey; Server prüft die Prekey-Signatur beim Upload
  - **X3DH** nach Signal-Spec (Fallback-Modus ohne One-Time-Prekeys, siehe ROADMAP), KDF = keyed BLAKE2b
  - **Double Ratchet** (BLAKE2b-Ketten, XChaCha20-Poly1305, Header als AD, MAX_SKIP-Schutz); alle Funktionen pure – Zustand wird erst nach erfolgreichem Ver-/Entschlüsseln persistiert
  - **Sender-Key-Ratchet** für Kanäle (Megolm-Prinzip): Kette + Ed25519-Signatur (Mit-Mitglieder können nichts fälschen), Entschlüsseln idempotent (frühester Stand + Vorspulen), AD bindet die Kanal-ID
- **API:** `Device` (ein Gerät pro Account, nur öffentliche Schlüssel) + `KeyEnvelope`-Mailbox (Ende-zu-Ende-verschlüsselte Sender-Key-Verteilung, Ack = DELETE, Live-Zustellung als `KEY_ENVELOPE`-Event); `PUT /keys`, `GET /users/:id/keys`, `POST/GET/DELETE /envelopes`; `Message` speichert nur noch `ciphertext`+`nonce`+`header` (Migration `e2ee` löscht die Klartext-Bestände); Identitätswechsel = Schlüssel-Reset (verwirft liegengebliebene Umschläge)
- **Web-Client:** `lib/e2ee.ts` (Schlüssel in IndexedDB pro Nutzer, Web-Lock für Multi-Tab, Sender-Key-Verteilung vor dem Senden, Rotation nach `SERVER_MEMBER_REMOVE`), entschlüsselte Texte nur im Speicher, 🔒-Platzhalter für (noch) nicht entschlüsselbare Nachrichten, 🔒-Badge im Kanal-Header
- **Review-Fixes dieser Session:** (1) Schlüssel-Reset eines Mitglieds wird bei der Sender-Key-Verteilung jetzt erkannt (`distributedTo` vergleicht den Identitätsschlüssel – vorher wäre das Mitglied dauerhaft ohne Schlüssel geblieben); (2) bereits verarbeitete Umschläge werden erneut geackt, falls das Lösch-DELETE damals fehlschlug; (3) fehlgeschlagene E2EE-Initialisierung friert nicht mehr bis zum Reload ein (Reconnect versucht es erneut); (4) unbehandelte Promise-Rejections im Gateway-Dispatcher beseitigt

**Verifiziert:** Skript mit 33 Checks, alle grün – u. a.: DB enthält nur Ciphertext (`content`-Spalte weg, kein Klartext, keine privaten Schlüssel, Chain-Keys in Umschlägen nur verschlüsselt); X3DH+Ratchet-Umschlag offline (Mailbox) und live (Gateway); Vorspulen/Out-of-Order; **Beitritts-Semantik** (Nachrichten vor dem Beitritt bleiben unlesbar); **Rotation nach Austritt** (Ausgetretener: kein Event, History 404, alte Schlüssel passen nicht); Schlüssel-Reset verwirft Mailbox; Validierung (ungültige Prekey-Signatur 400, Umschlag >16 KiB 400, ohne Header 400). Interop-Test Web-Client ↔ Skript-Client: UI-Nachricht wird nach friedas Schlüssel-Reset automatisch neu verteilt und entschlüsselt, friedas verschlüsselte Antwort erscheint lesbar in der UI, übersteht Reload (IndexedDB); alte, fremdverschlüsselte Nachrichten zeigen den 🔒-Platzhalter. Build/Tests (21)/Lint/Format grün.

### Phase 7 – Direktnachrichten & Freunde (07.07.2026)

Wie Phase 5/6 kam die Implementierung als angelieferter Commit (`8cd249e`); diese Session hat reviewt, drei Lücken geschlossen und die Phase verifiziert.

- **Prisma:** `Friendship` (eine Zeile pro Richtung, `userId` = Initiator des aktuellen Zustands: PENDING/ACCEPTED/BLOCKED; gegenseitige Blocks möglich), `DmMember` (n:m, v1 = genau zwei), `Channel.dmKey` (kanonischer Paar-Schlüssel „kleinereId:größereId“ mit Unique-Index – verhindert doppelte DM-Kanäle beim gleichzeitigen Öffnen, Race wird per P2002-Catch aufgelöst); Migration `friends_dms`
- **Freunde-REST** (`apps/api/src/friends/`): Anfrage per Benutzername (Gegen-Anfrage wird direkt angenommen), annehmen, ablehnen/zurückziehen/entfreunden (ein DELETE), blockieren/entblocken. Kein Leak: Wer mich blockiert, taucht bei mir nirgends auf; Anfrage bei Blockierung in irgendeiner Richtung → generisches 400. Jede Änderung löst `FRIENDS_UPDATE` an beide aus (Clients laden die Liste neu)
- **DM-REST** (`apps/api/src/dms/`): `GET/POST /api/dms`; Policy: DMs zwischen Freunden ODER Mitgliedern gemeinsamer Server, Blockierung sperrt Öffnen und SENDEN in beide Richtungen (History bleibt lesbar, wie Discord). `MessagesService` behandelt DM-Kanäle (nur die zwei Teilnehmer, 404 für Außenstehende) neben Server-Kanälen
- **DM-E2EE:** DMs nutzen denselben Sender-Key-Ratchet wie Kanäle (verteilt über die X3DH+Double-Ratchet-Sessions aus Phase 6) – **bewusste Abweichung** von CLAUDE.md §6 (reines Double Ratchet), weil History ohne lokalen Klartext-Speicher nach Reload neu entschlüsselbar sein muss; Trade-off in ROADMAP.md dokumentiert
- **Presence gescoped:** READY-Snapshot und `PRESENCE_UPDATE` gehen nur noch an den Sichtbarkeitskreis (`VisibilityService`: Freunde + gemeinsame Server + DM-Partner); `PRESENCE_SYNC` liefert additiv nach, wenn der Kreis wächst (Server-Beitritt); neue Freundschaft pusht den Online-Status an beide
- **Sichtbarkeits-Härtung:** `POST /api/envelopes` (403) und – Review-Fix dieser Session – `GET /users/:id/keys` (404, kein Existenz-Leak per UUID-Raten) verlangen den Sichtbarkeitskreis
- **Frontend:** Home-Ansicht (Zuhause-Button mit Anfragen-Badge → DM-Liste mit Online-Punkten + Freunde-Panel mit Tabs Freunde/Anfragen/Blockiert), `ChatView` im DM-Modus (@ statt #, kein Rechte-Gate), Stores `friends`/`dms`, neue Gateway-Events verdrahtet
- **Review-Fixes dieser Session:** (1) `accept()` räumt die Gegen-Anfrage mit ab, falls sich beide gleichzeitig angefragt haben (sonst bliebe eine PENDING-Zeile für immer liegen); (2) Schlüsselbündel-Abruf auf Sichtbarkeitskreis beschränkt (s. o.); (3) Lint-Fehler (ungenutztes `get` im DMs-Store)

**Verifiziert:** Skript mit 41 Checks, alle grün – u. a.: kompletter Anfrage-Lebenszyklus inkl. Gegen-Anfrage-Auto-Accept; Presence-Scoping (Fremde sehen sich weder im READY-Snapshot noch per PRESENCE_UPDATE; neue Freundschaft/Server-Beitritt liefern nach); DM-Policy (Freunde ✓, gemeinsamer Server ✓, Fremde 403, selbst 400, kanonische Kanal-ID von beiden Seiten); E2EE-Roundtrip in beide Richtungen; Blockieren (Senden 403 beidseitig, History lesbar, DM-Öffnen 403, generische 400er, kein Leak zur Gegenseite, Entblocken stellt Senden wieder her); Bundle/Umschlag-Sichtbarkeit. DB-Check: nur Ciphertext, DM-Kanal ohne Server mit dmKey. Interop-Test UI ↔ Skript: Anfrage-Badge live, Annehmen in der UI, verschlüsselte DMs in beide Richtungen lesbar, übersteht Reload (IndexedDB), Konsole sauber. Build/Tests (21)/Lint/Format grün.

## Nächste Phase

**Phase 8 – Datei-/Bild-Uploads:** Verschlüsselte Anhänge über MinIO (Client verschlüsselt die Datei, lädt Ciphertext hoch; `Attachment`-Modell aus CLAUDE.md Abschnitt 5), Vorschaubilder. MinIO läuft bereits in der Dev-Infra, wird aber erstmals wirklich genutzt (Bucket-Setup, presigned URLs o. Ä. zu entscheiden).

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
- Infrastruktur: `docker compose -f infra/docker-compose.yml up -d` – **läuft seit Session 5 (07.07.2026) in Docker** (Container `parley-postgres-1`/`parley-redis-1`/`parley-minio-1`); DB-Zugriff z. B. `docker exec -i parley-postgres-1 psql -U parley -d parley`. Fallback ohne Docker: `scripts\dev-infra.ps1` (die portablen Binaries unter `%LOCALAPPDATA%\Programs\parley-infra` existieren dort nicht mehr unbedingt – vor Nutzung prüfen)
- Testnutzer in der Dev-DB (frisch angelegt in Session 3): `arian.test@example.com` und `frieda.test@example.com`, Passwort jeweils `test-passwort-123`
- Session 4 (06.07.2026): Dev-DB stand nur auf der Phase-1-Migration – `servers_channels`, `messages` und `roles` per `prisma migrate deploy` nachgezogen; Server „Arians Treffpunkt“ (Owner `arian_test`) neu angelegt, alte Server/Nachrichten waren weg
- `core.autocrlf=true` ist global gesetzt – `.gitattributes` pinnt deshalb LF für den Working Tree; nach einem frischen Checkout ggf. einmal `git add --renormalize .` bzw. Prettier laufen lassen
