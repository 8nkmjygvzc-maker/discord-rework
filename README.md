# Parley (Arbeitstitel)

Eigenständige, Ende-zu-Ende-verschlüsselte Chat-/Voice-/Video-Plattform im Funktionsumfang von Discord – eigenes Backend, eigenes Protokoll, keine Discord-API.

Der vollständige Arbeitsauftrag steht in [CLAUDE.md](CLAUDE.md), der Projektfortschritt in [PROGRESS.md](PROGRESS.md), offene Punkte in [ROADMAP.md](ROADMAP.md). Das Deployment auf einen VPS (GitHub Actions → GHCR → Docker Compose) ist in [DEPLOY.md](DEPLOY.md) beschrieben.

## Struktur

```
/apps
  /web        React-Frontend (Vite, TailwindCSS, Zustand)
  /api        NestJS REST-API + WebSocket-Gateway
  /voice      mediasoup-SFU-Service (ab Phase 10)
/packages
  /shared     gemeinsame Typen, Opcode-Definitionen, Krypto-Utils
/infra
  docker-compose.yml        PostgreSQL, Redis, MinIO (lokale Entwicklung)
  docker-compose.prod.yml   Produktions-Stack für den VPS (siehe DEPLOY.md)
```

## Voraussetzungen

- **Node.js ≥ 22** (installiert unter `%LOCALAPPDATA%\Programs\nodejs`)
- **PostgreSQL 16, Redis, MinIO** – wahlweise:
  - über **Docker Desktop**: `docker compose -f infra/docker-compose.yml up -d`, oder
  - **portabel ohne Docker/Admin-Rechte**: Binaries unter `%LOCALAPPDATA%\Programs\parley-infra`,
    Start per `powershell -ExecutionPolicy Bypass -File scripts\dev-infra.ps1`
    (Einrichtung siehe PROGRESS.md, Abschnitt „Dev-Umgebung“)

## Setup (einmalig)

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Umgebungsvariablen anlegen (JWT_SECRET generieren!)
copy .env.example .env

# 3. Prisma-Client generieren
npm run prisma:generate
```

## Start – ein Befehl

```bash
npm run dev
```

Das erledigt alles: `@parley/shared` bauen, Infrastruktur sicherstellen
(läuft schon alles, passiert nichts; sonst Docker Compose oder – ohne
Docker-Daemon – die portable Infra), Migrationen anwenden (`prisma migrate
deploy`) und dann **API + Voice-SFU + Web parallel** mit gelabelter Ausgabe
(`concurrently`, Strg+C beendet alle drei). Alternativ doppelklickbar:
`scripts\dev.cmd`.

- Web: http://localhost:5173 · API: http://localhost:3001/api/health · Voice-SFU: Port 3002

Einzeln geht weiterhin: `npm run dev:api` / `npm run dev:voice` / `npm run dev:web`,
Infrastruktur allein: `npm run dev:infra`.

## Nützliche Befehle

| Befehl                    | Zweck                                 |
| ------------------------- | ------------------------------------- |
| `npm run dev`             | ALLES starten (Infra + api/voice/web) |
| `npm run dev:infra`       | nur Infrastruktur sicherstellen       |
| `npm run build`           | alles bauen (shared → api → web)      |
| `npm test`                | Vitest in allen Workspaces            |
| `npm run lint`            | ESLint über das gesamte Repo          |
| `npm run format`          | Prettier über das gesamte Repo        |
| `npm run prisma:migrate`  | DB-Migration erstellen/anwenden (Dev) |
| `npm run prisma:generate` | Prisma-Client neu generieren          |
