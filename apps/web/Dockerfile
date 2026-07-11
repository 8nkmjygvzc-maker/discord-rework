# Produktions-Image des Parley Web-Clients: Vite-Build + nginx.
# nginx liefert die statischen Dateien aus und proxied /api, /gateway und
# /voice an die internen Container – der Web-Container ist damit der einzige
# HTTP-Einstiegspunkt des Stacks (siehe apps/web/nginx.conf).
# Build-Kontext ist das Repo-Root (npm-Workspaces):
#   docker build -f apps/web/Dockerfile .

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
COPY apps/web apps/web

# Shared zuerst bauen: `tsc --noEmit` des Web-Builds löst die Typen von
# @parley/shared über dessen package.json nach dist/ auf.
RUN npm run build -w @parley/shared \
  && npm run build -w @parley/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
