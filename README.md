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
- **Docker Desktop** (für PostgreSQL/Redis/MinIO – ab Phase 1 nötig)

## Setup & Start

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Umgebungsvariablen anlegen
copy .env.example .env

# 3. Infrastruktur starten (benötigt Docker Desktop)
docker compose -f infra/docker-compose.yml up -d

# 4. Backend + Frontend im Dev-Modus (zwei Terminals)
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
