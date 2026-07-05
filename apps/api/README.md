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
| POST    | `/api/servers/:id/join`     | beitreten per Server-ID (Invites: Phase 12)       |
| POST    | `/api/servers/:id/leave`    | verlassen (Owner nicht)                           |
| POST    | `/api/servers/:id/channels` | Kanal anlegen (nur Owner)                         |
| PATCH   | `/api/channels/:id`         | Kanal umbenennen/verschieben (nur Owner)          |
| DELETE  | `/api/channels/:id`         | Kanal löschen (nur Owner)                         |

Änderungen werden zusätzlich als Gateway-Events an die betroffenen Mitglieder
dispatcht (`SERVER_*`, `CHANNEL_*` – gezielt über `publishDispatch(..., userIds)`).
„Nur Owner“ gilt bis Phase 5 – dann übernimmt das Rollen-/Berechtigungssystem.

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
