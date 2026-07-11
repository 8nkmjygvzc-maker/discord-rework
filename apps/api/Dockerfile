# Produktions-Image der Parley-API (NestJS REST + WebSocket-Gateway).
# Build-Kontext ist das Repo-Root (npm-Workspaces):
#   docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app

# OpenSSL schon im Build-Stage: Prisma erkennt daran die Plattform
# (debian-openssl-3.0.x). Fehlt es, generiert `prisma generate` den Client für
# openssl-1.1.x und die API startet im Laufzeit-Image nicht.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Erst nur die Manifeste kopieren – so bleibt der teure npm-ci-Layer im Cache,
# solange sich keine Abhängigkeiten ändern. Alle Workspace-Manifeste müssen
# vorhanden sein, sonst passt package-lock.json nicht (npm ci bricht ab).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/voice/package.json apps/voice/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

# Reihenfolge: Prisma-Client generieren (liefert die DB-Typen für den Build) →
# bauen (braucht Dev-Deps wie @nestjs/cli) → Dev-Deps entfernen → Client erneut
# generieren, weil `npm prune` node_modules/.prisma als „extraneous" entfernen
# kann. Die prisma-CLI ist eine Prod-Dependency der API, damit `migrate deploy`
# auch im Laufzeit-Image funktioniert.
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
  && npm run build -w @parley/shared \
  && npm run build -w @parley/api \
  && npm prune --omit=dev \
  && npx prisma generate --schema apps/api/prisma/schema.prisma

FROM node:22-bookworm-slim
ENV NODE_ENV=production

# Prisma-Engines benötigen OpenSSL; im Slim-Image fehlt es.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Kompletter Workspace-Baum inkl. node_modules-Symlinks (@parley/shared → packages/shared).
COPY --from=build /app /app

EXPOSE 3001
# Migrationen laufen beim Start (eine API-Instanz; bei mehreren Instanzen in
# einen separaten Deploy-Schritt auslagern – siehe ROADMAP).
CMD ["sh", "-c", "npx prisma migrate deploy --schema apps/api/prisma/schema.prisma && exec node apps/api/dist/main.js"]
