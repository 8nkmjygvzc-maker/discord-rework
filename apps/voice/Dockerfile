# Produktions-Image des Parley Voice-SFU (mediasoup).
# Build-Kontext ist das Repo-Root (npm-Workspaces):
#   docker build -f apps/voice/Dockerfile .
#
# Hinweis: `npm ci` lädt den vorgebauten mediasoup-Worker für linux-x64 (glibc)
# herunter. Schlägt der Download fehl, versucht mediasoup selbst zu kompilieren –
# dann würden python3/make/g++ fehlen. In dem Fall hier nachinstallieren.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/voice/package.json apps/voice/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/voice apps/voice

RUN npm run build -w @parley/shared \
  && npm run build -w @parley/voice \
  && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app

# 3002 = Signaling-WebSocket. Die RTC-Medienports (UDP/TCP, MEDIASOUP_MIN/MAX_PORT)
# werden über docker-compose als Port-Range veröffentlicht.
EXPOSE 3002
CMD ["node", "apps/voice/dist/main.js"]
