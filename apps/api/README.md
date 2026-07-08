# @parley/api

NestJS-Backend: REST-API und WebSocket-Gateway.

## Struktur

- `src/health/` – Health-Check (`GET /api/health`)
- `src/prisma/` – globaler Prisma-Service (PostgreSQL)
- `src/redis/` – globaler Redis-Service (Presence, Rate-Limiting, Pub/Sub)
- `src/common/` – wiederverwendbare Bausteine (z. B. `RateLimitGuard`)
- `src/auth/` – Registrierung, Login, Refresh, Logout
- `src/users/` – Profil des angemeldeten Nutzers
- `src/gateway/` – Echtzeit-Gateway (natives `ws`, eigenes Opcode-Protokoll, Presence)
- Weitere Module folgen phasenweise: Servers, Channels, Messages, Roles, Voice-Signaling

## Echtzeit-Gateway (Phase 2)

WebSocket-Endpunkt `ws://…/gateway` am selben HTTP-Server wie die REST-API.
Protokolldefinition (Opcodes, Events, Payloads): `packages/shared/src/gateway.ts`.

- Ablauf: HELLO → IDENTIFY (Access-Token) → READY → HEARTBEAT alle 15 s
- Presence liegt in Redis (`presence:conn:*`-Zähler mit TTL + `presence:users`-Hash),
  funktioniert dadurch über mehrere API-Instanzen hinweg
- Alle Dispatch-Events laufen über Redis-Pub/Sub (`gateway:dispatch`) – auch an
  die eigene Instanz; ein Codepfad für 1..N Instanzen
- Auth-Endpunkte sind per `RateLimitGuard` (Redis, Fixed Window, pro IP) gedrosselt

## Endpoints (Phase 1)

| Methode | Pfad                 | Auth   | Zweck                                    |
| ------- | -------------------- | ------ | ---------------------------------------- |
| POST    | `/api/auth/register` | –      | Konto anlegen, meldet direkt an          |
| POST    | `/api/auth/login`    | –      | Anmelden (E-Mail + Passwort)             |
| POST    | `/api/auth/refresh`  | Cookie | Access-Token erneuern (Rotation)         |
| POST    | `/api/auth/logout`   | Cookie | Refresh-Token widerrufen, Cookie löschen |
| GET     | `/api/users/me`      | Bearer | eigenes Profil                           |
| PATCH   | `/api/users/me`      | Bearer | Status/Avatar ändern                     |

Access-Token: JWT, 15 min, gehört in den `Authorization: Bearer`-Header.
Refresh-Token: httpOnly-Cookie `parley_refresh` (Pfad `/api/auth`), 30 Tage, rotierend.

## Endpoints (Phase 3 – alle mit Bearer-Auth)

| Methode | Pfad                        | Zweck                                             |
| ------- | --------------------------- | ------------------------------------------------- |
| POST    | `/api/servers`              | Server anlegen (Ersteller = Owner, Standardkanal) |
| GET     | `/api/servers`              | eigene Server                                     |
| GET     | `/api/servers/:id`          | Details (Kanäle + Mitglieder, nur Mitglieder)     |
| PATCH   | `/api/servers/:id`          | umbenennen/Icon (nur Owner)                       |
| DELETE  | `/api/servers/:id`          | löschen (nur Owner)                               |
| POST    | `/api/servers/:id/leave`    | verlassen (Owner nicht)                           |
| POST    | `/api/servers/:id/channels` | Kanal anlegen (nur Owner)                         |
| PATCH   | `/api/channels/:id`         | Kanal umbenennen/verschieben (nur Owner)          |
| DELETE  | `/api/channels/:id`         | Kanal löschen (nur Owner)                         |

Änderungen werden zusätzlich als Gateway-Events an die betroffenen Mitglieder
dispatcht (`SERVER_*`, `CHANNEL_*` – gezielt über `publishDispatch(..., userIds)`).
„Nur Owner“ gilt bis Phase 5 – dann übernimmt das Rollen-/Berechtigungssystem.
Der frühere `POST /api/servers/:id/join` (Beitritt per Server-ID) ist seit
Phase 12 entfernt – beitreten geht nur noch über Einladungscodes (s. u.).

## Endpoints (Phase 4 – Nachrichten, Bearer-Auth)

| Methode | Pfad                                      | Zweck                                         |
| ------- | ----------------------------------------- | --------------------------------------------- |
| POST    | `/api/channels/:id/messages`              | Nachricht senden (nur Mitglieder, Rate-Limit) |
| GET     | `/api/channels/:id/messages?before=<ISO>` | History, 50er-Seiten rückwärts                |

Neue Nachrichten erreichen die Mitglieder als `MESSAGE_CREATE`-Gateway-Event.
Phase 4 speicherte bewusst Klartext (`content`) – seit Phase 6 nimmt der Server
nur noch `ciphertext` + `nonce` + Klartext-`header` an (E2EE, s. u.).

## Rollen & Berechtigungen (Phase 5)

Bitfield-Definition in `packages/shared/src/permissions.ts` (BigInt, über JSON
als Dezimal-String). Effektive Rechte: Owner → Administrator; sonst
Standardrolle ∪ zugewiesene Rollen (Bit-OR). Durchsetzung zentral im
`PermissionsService` – in JEDEM Endpunkt serverseitig, die UI blendet nur aus.

| Methode    | Pfad                                             | Recht                     |
| ---------- | ------------------------------------------------ | ------------------------- |
| POST       | `/api/servers/:id/roles`                         | ManageRoles               |
| PATCH      | `/api/roles/:id`                                 | ManageRoles               |
| DELETE     | `/api/roles/:id`                                 | ManageRoles (nie Default) |
| PUT/DELETE | `/api/servers/:id/members/:userId/roles/:roleId` | ManageRoles               |

Geänderte Rechte-Anforderungen bestehender Endpunkte: Server-PATCH → ManageServer,
Kanal-CRUD → ManageChannels, Nachricht senden → SendMessages, History → ViewChannels.
Server-DELETE bleibt Owner-only. Events: `ROLE_CREATE/UPDATE/DELETE`,
`MEMBER_ROLES_UPDATE`.

## Ende-zu-Ende-Verschlüsselung (Phase 6)

Der Server speichert und verteilt ausschließlich **öffentliche** Schlüssel und
Ciphertext – entschlüsseln können nur die Clients (Protokoll und Primitiven:
`packages/shared/src/crypto/`, Orchestrierung: `apps/web/src/lib/e2ee.ts`).
Das `keys/`-Modul validiert beim Upload lediglich, dass die Prekey-Signatur zum
Identitätsschlüssel passt (libsodium), und transportiert Ende-zu-Ende
verschlüsselte Schlüssel-Umschläge über eine Mailbox (Empfänger löscht per Ack).

| Methode | Pfad                  | Zweck                                                           |
| ------- | --------------------- | --------------------------------------------------------------- |
| PUT     | `/api/keys`           | eigene öffentliche Geräteschlüssel veröffentlichen/erneuern     |
| GET     | `/api/users/:id/keys` | Schlüsselbündel eines Nutzers für X3DH abrufen                  |
| POST    | `/api/envelopes`      | verschlüsselten Schlüssel-Umschlag zustellen (max. 16 KiB)      |
| GET     | `/api/envelopes`      | eigene ungelesene Umschläge abholen (Login-/Reconnect-Abgleich) |
| DELETE  | `/api/envelopes/:id`  | Umschlag quittieren (löschen, idempotent)                       |

Ein Identitätsschlüssel-Wechsel beim `PUT /api/keys` gilt als Schlüssel-Reset:
liegengebliebene Umschläge des Nutzers werden verworfen (unlesbar geworden).
Live zugestellte Umschläge kommen zusätzlich als `KEY_ENVELOPE`-Gateway-Event.
v1 = genau ein Gerät pro Account (`Device.userId` unique, Multi-Device: ROADMAP).

## Verschlüsselte Anhänge (Phase 8)

Anhänge verschlüsselt der Client mit einem frischen Zufallsschlüssel pro Datei;
der Server speichert nur den Ciphertext-Blob in MinIO (`storage/`-Modul) plus
ID und Blob-Größe in der DB. Dateiname, MIME-Typ, Klartextgröße und
Dateischlüssel reisen IM E2EE-Nachrichtentext (`MessageContentV1` in
`@parley/shared`) – der Server sieht sie nie.

| Methode | Pfad                            | Zweck                                                                              |
| ------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| POST    | `/api/channels/:id/attachments` | Ciphertext-Blob hochladen (`application/octet-stream`, ≤ 10 MiB, Recht wie Senden) |
| GET     | `/api/attachments/:id`          | Blob streamen (nur Kanal-Mitglieder; ungebundene Blobs: nur der Uploader)          |

Beim Senden bindet `POST /messages` die `attachmentIds` transaktional an die
Nachricht – nur eigene, noch unverbrauchte Uploads DESSELBEN Kanals, max. 10
pro Nachricht; schlägt das Binden fehl, wird auch die Nachricht zurückgerollt.
Aufräumen: nie gebundene Uploads entsorgt ein periodischer Job (beim Start und
stündlich, Frist 6 h); Kanal-/Server-Löschung entfernt die Blobs des Kanals
best-effort aus MinIO (`StorageService.removeAllWithPrefix`).

## Einladungen & Web-Push (Phase 12)

Einladungscodes (8 Zeichen base62) verweisen auf einen Server, optional mit
Ablaufdatum und/oder Nutzungslimit; Nutzungen werden atomar verbraucht
(parallele Einlösungen können ein Limit nicht überschreiten). Erstellen/Listen
verlangt das `CreateInvite`-Recht (nicht in der Standardrolle), Einlösen kann
jeder angemeldete Nutzer mit gültigem Code.

| Methode | Pfad                       | Zweck                                                        |
| ------- | -------------------------- | ------------------------------------------------------------ |
| POST    | `/api/servers/:id/invites` | Einladung erstellen (CreateInvite)                           |
| GET     | `/api/servers/:id/invites` | Einladungen des Servers (CreateInvite)                       |
| GET     | `/api/invites/:code`       | Vorschau (Name, Mitgliederzahl, Einlader; 404 wenn ungültig) |
| POST    | `/api/invites/:code`       | einlösen → Beitritt (Wieder-Einlösen verbraucht nichts)      |
| DELETE  | `/api/invites/:code`       | widerrufen (Ersteller oder ManageServer)                     |

Web-Push (`push/`-Modul, `web-push` + VAPID): Push geht nur an Nutzer OHNE
aktive Gateway-Verbindung und ist wegen E2EE inhaltsarm (Absender/Kanal als
Metadaten, kein Nachrichtentext). DM-Nachrichten pushen den Offline-Partner
automatisch; für Server-Kanäle meldet der sendende Client Erwähnte über
`POST /api/channels/:id/notify-mentions` (Server prüft die Sende-Berechtigung
und filtert auf Kanal-Mitglieder). Subscription-Endpoints müssen https sein
(SSRF-Schutz), max. 10 pro Nutzer; 404/410 vom Push-Dienst löscht die
Subscription. Ohne `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` in `.env` ist Push
deaktiviert (Schlüssel erzeugen: `node -e "console.log(require('web-push').generateVAPIDKeys())"`).

| Methode | Pfad                         | Zweck                                    |
| ------- | ---------------------------- | ---------------------------------------- |
| GET     | `/api/push/vapid-public-key` | öffentlicher VAPID-Schlüssel (leer=aus)  |
| POST    | `/api/push/subscribe`        | Browser-Subscription registrieren        |
| POST    | `/api/push/unsubscribe`      | Subscription entfernen (Logout/Schalter) |

## Datenbank

```bash
npm run prisma:migrate   # im Root: Migration erstellen/anwenden (Dev)
npm run prisma:generate  # im Root: Client neu generieren
```

Voraussetzung: laufendes PostgreSQL (`docker compose -f infra/docker-compose.yml up -d`).

## Entwicklung

```bash
npm run dev -w @parley/api    # Watch-Modus auf Port 3001 (API_PORT in .env)
npm run build -w @parley/api  # Produktions-Build nach dist/
npm run start -w @parley/api  # Gebauten Stand starten
```

Voraussetzung: `@parley/shared` muss gebaut sein (`npm run build:shared` im Root).
