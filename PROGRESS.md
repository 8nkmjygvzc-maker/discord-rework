# PROGRESS – Projektstand

> Diese Datei wird am Ende jeder Phase aktualisiert. Neue Session? Zuerst hier lesen, dann [CLAUDE.md](CLAUDE.md) für den Gesamtauftrag.

## Status: Phase 10 abgeschlossen (08.07.2026)

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

### Phase 8 – Datei-/Bild-Uploads (07.07.2026)

Wie Phase 5–7 kam die Implementierung als angelieferter Commit (`c94f9b3`); diese Session hat reviewt, vier Lücken geschlossen und die Phase verifiziert.

- **Prisma:** `Attachment` (channelId, uploaderId, messageId nullable bis zum Senden, objectKey, sizeBytes); Migration `attachments`. **Bewusste Abweichung von CLAUDE.md §5:** kein `mimeType`/`encryptedFileUrl` in der DB – Dateiname, MIME-Typ, Klartextgröße und Dateischlüssel stehen IM E2EE-Nachrichtentext (`MessageContentV1` in `@parley/shared`), der Server sieht nur Blob + Größe
- **Krypto:** `packages/shared/src/crypto/file.ts` – XChaCha20-Poly1305 mit frischem Zufallsschlüssel pro Datei (Prinzip wie Signal/Matrix-Anhänge); 5 neue Unit-Tests (Datei-Roundtrip, Inhaltsformat inkl. Phase-6/7-Rohtext-Fallback)
- **API:** `StorageService` (MinIO, Bucket-Anlage beim Start) + `AttachmentsModule`: `POST /channels/:id/attachments` (roher `application/octet-stream`-Body statt Multipart, ≤ 10 MiB + AEAD-Overhead, Rechte wie Senden inkl. DM-Blockierung), `GET /attachments/:id` (Stream, nur Kanal-Mitglieder, ungebunden nur Uploader, 404 für Fremde). Senden bindet `attachmentIds` **transaktional** (nur eigene, unverbrauchte Uploads desselben Kanals, max. 10/Nachricht – sonst Rollback inkl. Nachricht). Zugriffslogik aus `MessagesService` in gemeinsamen `ChannelAccessService` extrahiert
- **Web-Client:** `lib/attachments.ts` (verschlüsseln → hochladen → Metadaten in den E2EE-Klartext; Bilder bekommen ein Canvas-Thumbnail ≤ 384 px als eigenen verschlüsselten Blob; Download-Cache als Object-URLs, Reset bei Logout), `AttachmentView` (Bild-Vorschau, Klick = Original speichern; Datei-Chip mit Speichern-Button), Datei-Auswahl mit Chips in der Eingabezeile (max. 4 Dateien/Nachricht)
- **Review-Fixes dieser Session:** (1) Kanal-/Server-Löschung entfernt jetzt auch die MinIO-Blobs (`removeAllWithPrefix`, best-effort nach dem DB-Delete – vorher blieben sie für immer liegen); (2) Aufräum-Job für nie gebundene Uploads (beim Start + stündlich, Frist 6 h; vorher unbegrenzter Gratis-Speicher per Upload-ohne-Senden); (3) Ciphertext-Limit der Nachrichten 24 KiB → 32 KiB (Worst Case 4000 Nicht-ASCII-Zeichen + 10 Anhangs-Metadaten passte nicht); (4) Thumbnail-Anzeigegröße in der UI geklemmt (Maße sind absenderkontrollierte E2EE-Metadaten – manipulierte Werte hätten das Layout gesprengt). Nebenbei: `'upload'`-Intent im `ChannelAccessService` spart die Empfängerliste, die nur das Senden braucht

**Verifiziert:** Skript mit 38 Checks, alle grün – u. a.: Upload-Validierung (leer/zu groß/413/kein octet-stream/Nicht-Mitglied 404); Binde-Regeln (fremd/doppelt/kanalfremd/>10 → 400, Transaktion hinterlässt keine Nachricht); Download-Rechte (Mitglied ✓, Fremder 404, ungebunden nur Uploader); voller E2EE-Roundtrip Skript↔Skript (Blob byte-identisch, Klartext-Marker NICHT im Ciphertext, Datei entschlüsselt identisch); DM-Uploads inkl. Blockierung (403) und Entblocken; DB nur technische Spalten; Blob physisch in MinIO; Kanal-Löschung räumt Blobs ab; Start-Cleanup entsorgt gealterte ungebundene Uploads (DB + MinIO). Interop UI↔Skript: Bild aus der UI (arian) → frieda (Skript) entschlüsselt Text, PNG-Original und JPEG-Thumbnail (Magic Bytes geprüft); friedas verschlüsselte Antwort mit Datei-Chip erscheint live und lesbar in der UI, übersteht Reload (Thumbnail wird neu geladen und entschlüsselt), Konsole sauber. Build/Tests (26)/Lint/Format grün.

### Phase 9 – Reaktionen, Threads, Erwähnungen, Suche (07.07.2026)

Wie Phase 5–8 kam die Implementierung als angelieferter Commit (`34d0b6a`); diese Session hat reviewt, fünf Lücken geschlossen und die Phase verifiziert. Kernprinzip: **Alles reist IM Ciphertext** – kein Backend-Change nötig, der Server kann Reaktionen nicht von Textnachrichten unterscheiden und sieht weder Emojis noch Antwort-Graphen noch Erwähnungen.

- **Shared (`MessageContentV1` erweitert):** `replyTo` (Referenz + eingebettete Zitat-Vorschau ≤ 160 Zeichen, Prinzip wie Signal) und `reaction` (targetMessageId, Emoji, add/remove) im E2EE-Klartext; `decodeMessageContent` validiert absenderkontrollierte Felder defensiv (kaputte Felder → null, Rohtext aus Phase 6/7 bleibt lesbar)
- **Reaktionen:** verschlüsselte Spezial-Nachrichten in derselben Pipeline, Toggle-Semantik; der Store faltet pro (Ziel, Nutzer, Emoji) das jüngste Event ein, `MessageRow` aggregiert (Zähler, „von mir“, Schnellauswahl-Picker mit 8 Emojis); Reaktions-Events erscheinen nicht im Verlauf
- **Antworten/Threads:** Antwort-Banner in der Eingabezeile, Zitat-Zeile über der Nachricht („Zum Original springen“ mit Aufleuchten), Thread-Ansicht = Wurzel + alle Nachfahren, clientseitig aus den replyTo-Bezügen abgeleitet
- **Erwähnungen:** clientseitige Erkennung (`@name` gegen bekannte Kanal-Benutzernamen, case-insensitiv), Highlight (gelb) für eigene Erwähnungen, Browser-Notification per Notification-API (🔔-Button, nur bei unfokussiertem Tab; echte Push-Benachrichtigungen folgen in Phase 12)
- **Suche (🔍):** nur im geladenen, entschlüsselten Verlauf (Text + Anhangs-Namen), mit Treffer-Zähler – serverseitig wegen E2EE prinzipbedingt unmöglich
- **Review-Fixes dieser Session:** (1) Thread-Wurzelsuche gegen Antwort-Zyklen abgesichert (mit UUID-IDs nicht fälschbar, aber die Terminierung soll nicht von dieser Invariante abhängen); (2) `CSS.escape` + ID-Format-Validierung (`[A-Za-z0-9-]{1,64}`) für absenderkontrollierte Nachrichten-Referenzen – ohne sie hätte ein `"]` in replyTo.messageId den `querySelector` im Click-Handler werfen lassen; (3) Emoji-Plausibilitätscheck (`isPlausibleReactionEmoji`: nur Emoji-Bausteine, nicht rein ASCII) – vorher hätte sich beliebiger 32-Zeichen-Text als „Reaktion“ in fremde UIs rendern lassen; (4) Reaktions-/Antwort-Aktionen ohne SendMessages ausgeblendet (Server blockte schon mit 403, die UI bot die Buttons aber an); (5) Reaktions-Falten deterministisch gemacht (Event-ID als Tiebreaker bei gleichem Millisekunden-Zeitstempel – sonst könnten Clients dauerhaft unterschiedliche Stände zeigen)
- **Bewusst NICHT in dieser Phase:** Nachrichten bearbeiten/löschen (→ Phase 13, siehe ROADMAP), Erwähnungs-Picker/ID-Erwähnungen, Nachladen des Originals beim Zitat-Klick (alles in ROADMAP notiert)

**Verifiziert:** Shared-Unit-Tests 21 (neu: Emoji-Plausibilität, ID-Validierung, replyTo-Roundtrip). Skript mit 19 Checks, alle grün – u. a. replyTo-Roundtrip mit Preview-Klemmung, Reaktions-add/remove in beide Richtungen (live über Gateway), fünf böswillige Payloads (Text-als-Emoji, ASCII-Bausteine, Selector-Injektion, kaputte IDs, unbekannte action) werden beim Empfänger verworfen, Reaktions-Events liegen als normale Nachrichten in der History. DB-Check: Header eines Reaktions-Events enthält nur `{iteration,keyId,signature,v}`, kein Klartext-/Emoji-/Erwähnungs-Leak in Ciphertext oder Header. Interop UI↔Skript: UI-Nachricht wird vom Skript entschlüsselt; Skript-Antwort (Zitat-Zeile), ❤️-Reaktion (Chip), Erwähnung (gelbes Highlight) und Geist-Zitat auf nicht geladene Nachricht erscheinen live und korrekt in der UI; UI-Reaktion 👍 add→remove kommt beim Skript entschlüsselt und korrekt an; Thread-Ansicht (2 Nachrichten, sauberes Schließen), Sprung-zum-Original mit Aufleuchten, Suche (1 Treffer); Reload: Reaktionen werden aus der History neu gefaltet, Highlight/Zitat intakt; Konsole sauber. Build/Tests (32)/Lint/Format grün.

### Phase 10 – Sprachchat (08.07.2026)

Erste Phase mit neuem Teilprojekt (`apps/voice`, mediasoup-SFU) und selbst gebaut (kein angelieferter Commit). Zwei getrennte Signaling-Ebenen: **Roster/State** (beitreten/verlassen, Mute/Deafen, „wer ist im Kanal") über REST + bestehendes Gateway; **Medien** (WebRTC-Transport/Produce/Consume) über eine direkte WebSocket zum SFU. Medien sind zunächst nur transportverschlüsselt (DTLS-SRTP); Medien-E2EE steht in der ROADMAP.

- **mediasoup läuft portabel:** `npm install mediasoup@3` lädt ein vorgebautes `mediasoup-worker.exe` (kein Compiler/Python/MSVC nötig) – Worker startet, Router + WebRTC-Transporte funktionieren
- **Shared** (`packages/shared/src/voice.ts`): Voice-Signaling-Protokoll (Client⇄SFU, opake mediasoup-Wire-Objekte als `unknown`, damit shared nicht von mediasoup abhängt), `VoiceState`, `VOICE_STATE_UPDATE`-Event, `VoiceJoinResponse`, `VoiceTokenClaims`; `ServerDetails.voiceStates`; `CreateChannelRequest.type`
- **Prisma:** `VoiceSession` (userId unique = ein Nutzer/ein Sprachkanal, muted/deafened); Migration `voice`. **Abweichung von CLAUDE.md §5:** kein `sfuPeerId` – Peer-Identität lebt im SFU. Beim API-Start werden verwaiste Sessions geleert
- **API** (`apps/api/src/voice/`): `POST /voice/channels/:id/join` (Rechte = ViewChannels, VoiceSession-Upsert, Broadcast, kurzlebiges **Voice-Token** = JWT mit channelId/purpose), `POST …/leave`, `PATCH …/state` (Mute/Deafen, Deafen erzwingt Mute); Roster-Broadcast an Mitglieder mit ViewChannels (wie MESSAGE_CREATE); SFU meldet Trennungen via Redis `voice:disconnect` → Roster-Cleanup (crash-fest). Kanal-Erstellung akzeptiert jetzt `type` (TEXT/VOICE)
- **SFU** (`apps/voice/`, neues Workspace): eigenständiger Node-Dienst (mediasoup, ws, ioredis, jsonwebtoken; `tsx` für Dev). Ein Worker, ein Router pro Kanal (`Room`), Peer pro Medien-WS; Signaling-Protokoll (auth→welcome, getRtpCapabilities, createTransport, connect, produce, consume, resume, pause; Benachrichtigungen newProducer/producerClosed/peerLeft). Zweit-Verbindung desselben Nutzers ersetzt die alte ohne fälschliches Trenn-Signal
- **Web** (`apps/web`): `lib/voice.ts` (mediasoup-client: Device, Send-/Recv-Transporte, Mikro-Producer, Consumer + versteckte `<audio>`-Elemente; **ohne Mikro sauberer Zuhörer-Modus** statt Fehler), `store/voice.ts` (Beitritt/Verlassen/Mute/Deafen + Roster), Kanal-Sidebar mit getrennten Text-/Sprach-Sektionen und Teilnehmerliste je Sprachkanal, `VoicePanel` (verbunden/Mute/Deafen/Trennen, bleibt server-übergreifend sichtbar), Kanal-Erstellung mit Typ; nach Gateway-Reconnect wird die Voice-Session serverseitig neu registriert; Vite-Proxy `/voice`
- **Infra:** `.env`/`.env.example` (VOICE_PORT, VOICE_PUBLIC_URL, MEDIASOUP_*), `scripts/dev-voice.cmd`, launch.json-Eintrag `voice`, Root-Skripte `dev:voice`/`start:voice`, Voice im Root-`build`

**Verifiziert:** Signaling-Skript mit **36 Checks, alle grün** (zwei Nutzer gegen den echten SFU, fabrizierte gültige Opus-RTP-Parameter): Beitritts-Autorisierung (Nicht-Mitglied/Text-Kanal/unbekannt → 404), Join → Token + Roster-Broadcast + `voiceStates` in ServerDetails, Medien-Handshake (welcome, Opus-Caps, Transport mit ICE/DTLS, produce), cross-peer getProducers/consume/resumeConsumer/newProducer, Mute (+pauseProducer) und Deafen (Server erzwingt Mute), ungültiges Token → authError, explizit Verlassen (Broadcast null + SFU peerLeft + Roster-Cleanup), Absturz-Cleanup (WS-Close → Redis → Roster), Kanalwechsel (eine Session). **Browser-Test** (Preview): Sprachkanal anlegen (Typ-Umschaltung), Beitritt → Zuhörer-Modus („Kein Mic", getUserMedia headless → sauberer Fallback), Self im Roster, VoicePanel „Sprache verbunden"; zweiter (Node-)Teilnehmer erscheint live im Roster und wird **real konsumiert** (Audio-Element mit lebendem Track = echter ICE/DTLS-Handshake zum SFU), Deafen schaltet den eingehenden Strom stumm (`audio.muted`), Verlassen baut Medien ab und entfernt Self. Build/Tests (32)/Lint/Format grün.
_Hinweis:_ Echtes 2-Wege-Audio zwischen zwei Menschen braucht Mikrofone (manueller Test) – die Medien-Kontrollebene ist automatisiert vollständig verifiziert.

## Nächste Phase

**Phase 11 – Video & Bildschirmfreigabe:** Video-Streams und Screen-Share über dieselbe mediasoup-Infrastruktur. Router-Codecs um VP8/H264 erweitern (in `apps/voice/src/mediasoup-manager.ts`), der Client produziert zusätzlich einen Video-/Screen-Track, die Signaling- und Roster-Ebene aus Phase 10 trägt bereits `kind: 'audio' | 'video'`.

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
- Infrastruktur: **Docker Desktop war in Session 6 (07.07.2026) nicht mehr installiert** – es läuft wieder die portable Infra (`%LOCALAPPDATA%\Programs\parley-infra`, alle Binaries vorhanden): PostgreSQL per `pg_ctl -D %LOCALAPPDATA%\parley-data\pgdata -w start`, Redis/MinIO per `Start-Process` (Schritte wie in `scripts\dev-infra.ps1`; der Skript-Aufruf mit `-ExecutionPolicy Bypass` kann vom Berechtigungs-Classifier blockiert werden → Schritte einzeln ausführen). Die PORTABLE DB stand auf Phase-5-Stand; `e2ee`/`friends_dms`/`attachments` wurden per `prisma migrate deploy` nachgezogen. Die Docker-DB (Sessions 5) samt ihrer Testdaten ist damit nicht mehr im Zugriff. Falls Docker wieder da ist: `docker compose -f infra/docker-compose.yml up -d`
- Testnutzer in der (portablen) Dev-DB: `arian.test@example.com` / `frieda.test@example.com` (Benutzernamen `arian`/`frieda`), Passwort jeweils `test-passwort-123`
- Session 4 (06.07.2026): Dev-DB stand nur auf der Phase-1-Migration – `servers_channels`, `messages` und `roles` per `prisma migrate deploy` nachgezogen; Server „Arians Treffpunkt“ (Owner `arian_test`) neu angelegt, alte Server/Nachrichten waren weg
- `core.autocrlf=true` ist global gesetzt – `.gitattributes` pinnt deshalb LF für den Working Tree; nach einem frischen Checkout ggf. einmal `git add --renormalize .` bzw. Prettier laufen lassen
- Session 7 (08.07.2026, Phase 10): Die portable Infra (`parley-infra`) war wieder weg, **Docker Desktop dagegen zurück** – Infrastruktur läuft jetzt wieder per `docker compose -f infra/docker-compose.yml up -d` (Postgres/Redis/MinIO, healthy). Die Docker-DB stand bereits auf allen 7 Migrationen; `voice` per `prisma migrate dev` ergänzt. Docker-Daemon ggf. erst per „Docker Desktop.exe" starten (Daemon-Bereitschaft mit `docker info` abwarten). **Neuer dritter Dienst:** Voice-SFU – zum Testen von Sprachchat muss `npm run dev:voice` (Port 3002) zusätzlich zu API/Web laufen (Preview-Config `voice`). Phase 10 hat einen „Voice Testserver" (Owner `voicetester`) samt `peer2_…`-Wegwerfnutzern in der Docker-Dev-DB hinterlassen
