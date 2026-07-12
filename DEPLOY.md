# Deployment: Parley auf einem VPS (GitHub Actions + Docker)

Diese Anleitung beschreibt das automatische Deployment auf einen VPS, auf dem
**bereits eine andere Website läuft**. Der Parley-Stack ist so gebaut, dass er
der bestehenden Website nicht in die Quere kommt:

- Web-Container bindet nur an `127.0.0.1:8080` (kein Konflikt mit Port 80/443)
- Postgres/Redis/MinIO sind ausschließlich im internen Docker-Netz erreichbar
- Nur die WebRTC-Medienports (UDP/TCP 40000–40100) gehen direkt nach außen
- Öffentlich erreichbar wird Parley über einen Reverse Proxy mit TLS (Schritt 5)

```
                              ┌─ dcparley.de ────────► parley-web:80 (nginx)
                              │                             │  statische SPA + Proxy
Internet ──► nexora-frontend │                             ├── /api, /gateway ─► api-Container
             (Caddy, TLS,    ─┤                             └── /voice ────────► voice-Container
              Port 80/443)    │
                              └─ nexora-studio.de ───► bestehende Website (unverändert)
Internet ──► UDP/TCP 40000–40100 ──────────────────────────► voice-Container (Medienströme)
```

Auf Arians VPS terminiert **derselbe** Caddy-Container (`nexora-frontend`), der
bereits `nexora-studio.de` bedient, per zusätzlichem Site-Block auch
`dcparley.de` (Details: Abschnitt 5, „Variante B – konkret: Nexora-Caddy").

**Ablauf pro Deploy:** Push auf `main` → GitHub Actions baut die drei Images
(api/voice/web), pusht sie nach GHCR und aktualisiert den Stack per SSH
(`docker compose pull && up -d`).

---

## 1. Bestandsaufnahme auf dem VPS

Per SSH einloggen und herausfinden, was schon läuft:

```bash
# Welche Container laufen bereits?
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'

# Wer belegt die Ports 80/443?
sudo ss -tlnp | grep -E ':80 |:443 '

# Läuft ein Webserver direkt auf dem Host?
systemctl is-active nginx apache2 caddy 2>/dev/null
```

Damit ergibt sich eine von drei Situationen – merken für Schritt 5:

| Befund | Bedeutung |
|---|---|
| `nginx`/`apache2`/`caddy` aktiv auf dem Host | **Variante A**: bestehenden Webserver als Reverse Proxy mitbenutzen |
| Ports 80/443 gehören einem Container (z. B. Traefik, Caddy, nginx-proxy) | **Variante B**: Parley an diesen Proxy-Container anbinden |
| Ports 80/443 sind frei | **Variante C**: Caddy installieren (einfachste Lösung, automatisches TLS) |

Außerdem prüfen, dass Docker + Compose-Plugin vorhanden sind (`docker compose version`)
und der Deploy-Benutzer in der `docker`-Gruppe ist (`groups`).

> **Befund auf Arians VPS (11.07.2026):** Variante B. `nexora-frontend`
> (Image `ghcr.io/rijonmjekiqi14/nexora-studio---frontend`) belegt 80/443
> selbst – ein Caddy-Container, der `nexora-studio.de` direkt terminiert
> (TLS, Frontend-Ausfall + `/api/*`-Proxy zum Backend). Sein Caddyfile ist
> ins Image gebacken (`docker inspect` zeigt keinen Bind-Mount, nur die
> Volumes `caddy_data`/`caddy_config`), also nicht von außen editierbar.
> Docker-Netzwerk: `nexora-net`. Konkrete Schritte dafür: Abschnitt
> „Variante B – Nexora-Caddy" unten.

## 2. Einmalige Einrichtung auf dem VPS

```bash
mkdir -p ~/parley && cd ~/parley

# .env anlegen – Vorlage: infra/.env.production.example aus dem Repo.
# Inhalt der Vorlage einfügen und alle leeren Werte setzen:
nano .env
```

Secrets direkt auf dem VPS generieren:

```bash
openssl rand -hex 64   # → JWT_SECRET
openssl rand -hex 32   # → POSTGRES_PASSWORD
openssl rand -hex 32   # → MINIO_ROOT_PASSWORD
curl -4 ifconfig.me    # → MEDIASOUP_ANNOUNCED_IP (öffentliche IPv4 des VPS)

# Optional für Browser-Push (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY):
docker run --rm node:22-bookworm-slim npx -y web-push generate-vapid-keys
```

Firewall für die WebRTC-Medienports öffnen (Beispiel ufw):

```bash
sudo ufw allow 40000:40100/udp
sudo ufw allow 40000:40100/tcp
```

> **Wichtig:** `~/parley/.env` bleibt dauerhaft auf dem Server und wird nie
> committet. Der Workflow bricht ab, wenn sie fehlt.

## 3. Deploy-SSH-Schlüssel und GitHub-Secrets

Auf dem eigenen Rechner ein eigenes Schlüsselpaar nur für Deployments erzeugen:

```bash
ssh-keygen -t ed25519 -f parley_deploy -C "parley-deploy" -N ""
```

- Inhalt von `parley_deploy.pub` auf dem VPS an `~/.ssh/authorized_keys` anhängen.
- Im GitHub-Repo unter **Settings → Secrets and variables → Actions** anlegen:

| Secret | Wert |
|---|---|
| `VPS_HOST` | IP oder Hostname des VPS |
| `VPS_USER` | SSH-Benutzer (Mitglied der `docker`-Gruppe) |
| `VPS_SSH_KEY` | kompletter Inhalt der **privaten** Datei `parley_deploy` |
| `VPS_PORT` | nur falls SSH nicht auf Port 22 läuft |

Für den GHCR-Zugriff ist kein weiteres Secret nötig – der Workflow verwendet
das automatische `GITHUB_TOKEN` (auch für den Pull auf dem VPS während des Laufs).

## 4. DNS

`dcparley.de` ist eine eigenständige Domain (keine Subdomain von
`nexora-studio.de`) – beim Domain-Anbieter einen A-Record auf die VPS-IP anlegen:

```
A    dcparley.de    →  <öffentliche IPv4 des VPS>
A    www.dcparley.de →  <öffentliche IPv4 des VPS>   (optional, falls www gewünscht)
```

Warten, bis der Record auflöst (`nslookup dcparley.de`).

## 5. Reverse Proxy (TLS)

> **Reihenfolge für Arians VPS (Nexora-Caddy, Variante B):** Der Live-Patch
> unten braucht den bereits laufenden Container `parley-web` als Ziel. Anders
> als die Kapitel-Nummerierung suggeriert, also so vorgehen:
> 1. Dieses Kapitel für Variante A/C **überspringen**.
> 2. Erst Schritt 6 („Erster Deploy") Punkte 1–3 durchführen (pushen, Actions
>    grün, `docker compose ps`/`curl 127.0.0.1:8080/api/health` auf dem VPS) –
>    **Schritt 6 Punkt 4 (Browser-Test über die Domain) überspringen**, die
>    Domain routet noch nirgendwohin.
> 3. Dann hier weiter zu „Variante B – konkret: Nexora-Caddy".
> 4. Danach zurück zu Schritt 6 Punkt 4 und `https://dcparley.de` testen.

### Variante A: bestehender nginx auf dem Host

Neue Datei `/etc/nginx/sites-available/parley`:

```nginx
server {
    listen 80;
    server_name dcparley.de;

    # Upload-Limit der App (verschlüsselte Anhänge bis ~10 MiB)
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket-Upgrade (für /gateway und /voice zwingend nötig)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Aktivieren und TLS per certbot holen:

```bash
sudo ln -s /etc/nginx/sites-available/parley /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d dcparley.de
```

(Bei Apache analog: `ProxyPass / http://127.0.0.1:8080/` plus
`mod_proxy_wstunnel` für die WebSocket-Pfade.)

### Variante B: vorhandener Proxy-Container (Traefik / nginx-proxy / Caddy)

Den Web-Container ins Netz des Proxys hängen und die Domain dort registrieren
(z. B. Traefik-Labels oder `VIRTUAL_HOST`). Dazu in `~/parley/docker-compose.prod.yml`
beim `web`-Service das externe Netz + Labels ergänzen — Details hängen vom
vorhandenen Setup ab; die Ausgabe von `docker ps` und der bestehenden
compose-Datei des Proxys zeigt, was nötig ist. `WEB_BIND` kann dann entfallen.

### Variante B – konkret: Nexora-Caddy auf Arians VPS

`infra/docker-compose.prod.yml` hängt den `web`-Service bereits zusätzlich in
ein externes Docker-Netz (`EXTERNAL_PROXY_NETWORK` in `.env`, Default
`nexora-net`) – das ist auf diesem VPS bereits richtig vorkonfiguriert.
Fehlend ist nur der Caddy-seitige Site-Block, weil `nexora-frontend`s
Caddyfile im Image steckt (kein Bind-Mount). Deshalb: **Live-Patch im
laufenden Container** (Caddy validiert vor dem Swap – `nexora-studio.de`
bleibt bei einem Fehler unberührt online).

**Vorbedingung:** Der erste Parley-Deploy (Schritt 6) muss bereits gelaufen
sein, damit der Container `parley-web` existiert und im Netz `nexora-net`
hängt. Prüfen:

```bash
docker network inspect nexora-net --format '{{range .Containers}}{{.Name}} {{end}}'
# sollte u. a. "parley-web" auflisten
```

Aktuellen Caddyfile-Inhalt sichern und lokal (auf dem VPS) um den Block für
`dcparley.de` ergänzen (fertig zum Copy-Paste; `www.dcparley.de` nur drin
lassen, wenn der optionale www-A-Record aus Schritt 4 gesetzt ist):

```bash
docker exec nexora-frontend cat /etc/caddy/Caddyfile > ~/nexora-caddyfile.backup
cp ~/nexora-caddyfile.backup ~/nexora-caddyfile.new

cat >> ~/nexora-caddyfile.new <<'EOF'

dcparley.de, www.dcparley.de {
    encode gzip zstd

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    # Caddy behandelt WebSocket-Upgrades (/gateway, /voice) automatisch mit –
    # anders als nginx braucht reverse_proxy hierfür keine Zusatzkonfiguration.
    reverse_proxy parley-web:80
}
EOF

# Neue Datei in den laufenden Container kopieren (überschreibt NICHT den
# Nexora-Block, ergänzt ihn nur) und Caddy per Admin-API (Port 2019,
# nur containerintern) neu laden lassen.
docker cp ~/nexora-caddyfile.new nexora-frontend:/etc/caddy/Caddyfile
docker exec nexora-frontend caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Danach `https://dcparley.de` testen. Bei einem Config-Fehler bricht
`caddy reload` mit einer Fehlermeldung ab, OHNE die laufende (gültige)
Config zu ersetzen – `nexora-studio.de` bleibt in jedem Fall erreichbar.

**Wichtige Einschränkung:** Das gebackene Caddyfile im Image gewinnt bei
jedem Neustart/Redeploy von `nexora-frontend` (z. B. `docker restart` oder
ein neues Nexora-Image) – der Parley-Block ist dann weg und muss mit den
obigen Befehlen erneut eingespielt werden (Backup liegt in
`~/nexora-caddyfile.backup`). Dauerhaft würde das nur eine Änderung an der
Bildquelle (`ghcr.io/rijonmjekiqi14/nexora-studio---frontend`) lösen – das
ist ein fremdes Image/Repo, dafür bräuchte es Zugriff auf dessen Build.

### Variante C: Ports 80/443 sind frei → Caddy

```bash
sudo apt install caddy
```

`/etc/caddy/Caddyfile`:

```
dcparley.de {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

Caddy besorgt TLS-Zertifikate automatisch und behandelt WebSockets ohne
Zusatzkonfiguration. Die bestehende Website müsste dann allerdings ebenfalls
über Caddy laufen – Variante C nur wählen, wenn 80/443 wirklich frei sind.

## 6. Erster Deploy

1. Alles committen und auf `main` pushen – oder den Workflow **Deploy** im
   GitHub-Tab „Actions" manuell starten (`workflow_dispatch`).
2. Im Actions-Log prüfen: 3× Build grün, Deploy grün (endet mit `docker compose ps`).
3. Auf dem VPS gegenprüfen:

```bash
cd ~/parley
docker compose -f docker-compose.prod.yml ps          # alle Dienste "running/healthy"?
docker compose -f docker-compose.prod.yml logs api    # Migrationen gelaufen?
curl -s http://127.0.0.1:8080/api/health              # {"status":"ok",...}
```

4. `https://dcparley.de` im Browser öffnen, registrieren, testen.
   Voice-Chat mit zwei Geräten testen (dafür müssen die UDP-Ports offen sein).

## 7. Betrieb

- **Update ausrollen:** einfach auf `main` pushen – der Rest passiert automatisch.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api` (bzw. `voice`, `web`)
- **Rollback:** In `~/parley/.env` den `IMAGE_TAG` auf den Git-SHA eines früheren
  Commits setzen (Tags stehen im GHCR-Paket bzw. Actions-Log), dann
  `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`.
  Achtung: bereits gelaufene DB-Migrationen werden dadurch nicht zurückgerollt.
- **Backups:** Das Docker-Volume `parley-prod_pgdata` enthält die Datenbank,
  `parley-prod_miniodata` die verschlüsselten Anhänge. Regelmäßig sichern, z. B.:
  `docker exec parley-prod-postgres-1 pg_dump -U parley parley | gzip > backup.sql.gz`
- **Skalierung:** Aktuell läuft genau eine API-Instanz (Migrationen laufen beim
  Containerstart). Für mehrere Instanzen den Migrationsschritt auslagern –
  vermerkt in `ROADMAP.md`.
