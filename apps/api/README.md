# @parley/api

NestJS-Backend: REST-API und (ab Phase 2) WebSocket-Gateway.

## Struktur

- `src/health/` – Health-Check (`GET /api/health`)
- `src/prisma/` – globaler Prisma-Service (PostgreSQL)
- `src/auth/` – Registrierung, Login, Refresh, Logout
- `src/users/` – Profil des angemeldeten Nutzers
- Weitere Module folgen phasenweise: Servers, Channels, Messages, Roles, Voice-Signaling

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
