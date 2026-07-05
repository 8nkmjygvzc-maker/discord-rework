# PROGRESS – Projektstand

> Diese Datei wird am Ende jeder Phase aktualisiert. Neue Session? Zuerst hier lesen, dann [CLAUDE.md](CLAUDE.md) für den Gesamtauftrag.

## Status: Phase 0 abgeschlossen (05.07.2026)

## Erledigt

### Phase 0 – Setup (05.07.2026)

- Monorepo mit npm-Workspaces: `apps/api` (NestJS 11), `apps/web` (React 19 + Vite + Tailwind 4), `packages/shared` (gemeinsame Typen, CJS-Build)
- Tooling: TypeScript strict (gemeinsame `tsconfig.base.json`), ESLint 9 (Flat Config) + Prettier auf Root-Ebene
- `infra/docker-compose.yml` mit PostgreSQL 16, Redis 7, MinIO (inkl. Healthchecks, Volumes, `.env`-Anbindung)
- API: `GET /api/health` liefert `HealthStatus` (Typ aus `@parley/shared`)
- Web: Statusseite, die `/api/health` über den Vite-Proxy abruft (kein CORS nötig)
- Git-Repo initialisiert (Branch `main`)
- Node.js 22 portabel installiert nach `%LOCALAPPDATA%\Programs\nodejs` und in den Benutzer-PATH eingetragen (kein Admin nötig)

**Verifiziert:** `npm install` + Builds fehlerfrei, API antwortet auf `/api/health`, Frontend zeigt den API-Status über den Proxy an.
**Noch offen aus Phase 0:** Docker Desktop ist auf dem Rechner nicht installiert → `docker compose up` konnte nicht verifiziert werden. Vor Phase 1 installieren (braucht Admin-Rechte), dann `docker compose -f infra/docker-compose.yml up -d` testen.

## Nächste Phase

**Phase 1 – Auth & Nutzerverwaltung:** Registrierung, Login, Access-/Refresh-Token, Argon2id-Hashing, Profilseite. Benötigt laufendes PostgreSQL (→ Docker Desktop) und Prisma-Setup.

## Notizen für kommende Sessions

- Projektname „Parley“ ist nur Arbeitstitel (siehe ROADMAP.md)
- Node ist NICHT systemweit installiert – falls `node` im PATH fehlt: `%LOCALAPPDATA%\Programs\nodejs` (User-PATH ist gesetzt, neue Terminals sollten es finden)
- Vitest ist noch nicht eingerichtet – bei der ersten testbaren Logik (Phase 1) nachziehen
