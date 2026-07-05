# Parley (Arbeitstitel)

Eigenständige, Ende-zu-Ende-verschlüsselte Chat-/Voice-/Video-Plattform im Funktionsumfang von Discord – eigenes Backend, eigenes Protokoll, keine Discord-API.

Der vollständige Arbeitsauftrag steht in [CLAUDE.md](CLAUDE.md), der Projektfortschritt in [PROGRESS.md](PROGRESS.md), offene Punkte in [ROADMAP.md](ROADMAP.md).

## Struktur

```
/apps
  /web        React-Frontend (Vite, TailwindCSS, Zustand)
  /api        NestJS REST-API + WebSocket-Gateway
  /voice      mediasoup-SFU-Service (ab Phase 10)
/packages
  /shared     gemeinsame Typen, Opcode-Definitionen, Krypto-Utils
/infra
  docker-compose.yml   PostgreSQL, Redis, MinIO
```

## Voraussetzungen

- **Node.js ≥ 22** (installiert unter `%LOCALAPPDATA%\Programs\nodejs`)
- **PostgreSQL 16, Redis, MinIO** – wahlweise:
  - über **Docker Desktop**: `docker compose -f infra/docker-compose.yml up -d`, oder
  - **portabel ohne Docker/Admin-Rechte**: Binaries unter `%LOCALAPPDATA%\Programs\parley-infra`,
    Start per `powershell -ExecutionPolicy Bypass -File scripts\dev-infra.ps1`
    (Einrichtung siehe PROGRESS.md, Abschnitt „Dev-Umgebung“)

## Setup & Start

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Umgebungsvariablen anlegen (JWT_SECRET generieren!)
copy .env.example .env

# 3. Infrastruktur starten (Docker ODER portabel, s. o.)
docker compose -f infra/docker-compose.yml up -d
# bzw.:  powershell -ExecutionPolicy Bypass -File scripts\dev-infra.ps1

# 4. DB-Schema anwenden und Prisma-Client generieren
npm run prisma:generate
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 5. Backend + Frontend im Dev-Modus (zwei Terminals)
npm run build:shared
npm run dev:api    # http://localhost:3001/api/health
npm run dev:web    # http://localhost:5173
```

## Nützliche Befehle

| Befehl                    | Zweck                                 |
| ------------------------- | ------------------------------------- |
| `npm run build`           | alles bauen (shared → api → web)      |
| `npm test`                | Vitest in allen Workspaces            |
| `npm run lint`            | ESLint über das gesamte Repo          |
| `npm run format`          | Prettier über das gesamte Repo        |
| `npm run prisma:migrate`  | DB-Migration erstellen/anwenden (Dev) |
| `npm run prisma:generate` | Prisma-Client neu generieren          |
