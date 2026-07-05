# ROADMAP – zurückgestellte Punkte, Schulden, Ideen

> Laufend gepflegt (siehe CLAUDE.md Abschnitt 8). Nichts hier ist vergessen – nur bewusst verschoben.

## Zurückgestellte Features

- **Multi-Device-Support:** v1 startet mit einem Gerät pro Account; Geräte-Verknüpfung wie bei Signal/WhatsApp später (CLAUDE.md Abschnitt 6)
- **Serverseitige Volltextsuche:** wegen E2EE prinzipbedingt nicht möglich; v1 sucht nur clientseitig in entschlüsselten Nachrichten
- **Voice/Video-E2EE:** Voice läuft zunächst nur transportverschlüsselt (TLS/DTLS-SRTP über SFU), echte E2EE (z. B. Insertable Streams) später
- **Native Clients / Desktop-App:** perspektivisch, u. a. wegen des Web-E2EE-Trade-offs (s. u.)

## Offene Sicherheits-Trade-offs

- **Web-E2EE-Grundproblem:** Der Server liefert den Krypto-Code als JavaScript aus; ein kompromittierter Server könnte manipulierten Code ausliefern. Milderungen später: Subresource Integrity, signierte Builds, native Clients (CLAUDE.md Abschnitt 6)
- Dev-Standardpasswörter in `docker-compose.yml`-Defaults (`parley_dev_password`) – nur für lokale Entwicklung; vor jedem echten Deployment durch Secrets ersetzen

## Technische Schulden / Vereinfachungen

- `@parley/shared` wird als CommonJS gebaut; der Web-Client umgeht das per Vite-Alias direkt auf die TS-Quelle (Rollup kann CJS-Enum-Re-Exports nicht statisch auflösen). Falls das später stört: Dual-Build (ESM+CJS)
- npm 10.9.8 gebündelt mit Node 22 – Update auf npm 11 optional
- ~~Docker-Compose-Verifikation~~ ✓ nachgeholt (05.07.2026), ~~Vitest-Setup~~ ✓ mit Phase 1 erledigt
- **Presence-Edge-Case:** Stürzt eine Gateway-Instanz hart ab, wird kein `PRESENCE_UPDATE offline` publiziert – der Redis-TTL (60 s) räumt den Zähler auf und `getOnlineUsers()` entfernt Leichen lazy, aber bereits verbundene Clients sehen den Nutzer bis zum nächsten READY-Snapshot als online. Fix-Idee: Redis-Keyspace-Notifications oder periodischer Abgleich
- **Presence-Snapshot skaliert linear** (`HGETALL presence:users` + EXISTS-Pipeline) – bei sehr vielen Nutzern auf Server-/Freundeskreis-Scoping umstellen (kommt ohnehin mit Phase 3/7)
- **`trust proxy`** ist in Express nicht gesetzt – `req.ip` ist hinter einem Reverse-Proxy die Proxy-IP. Vor echtem Deployment setzen, sonst drosselt das Rate-Limit alle Nutzer gemeinsam
- **Dev-Infra ohne Docker:** Auf Maschinen ohne Docker Desktop laufen PostgreSQL/Redis/MinIO portabel (`scripts/dev-infra.ps1`); Redis ist dort ein 5.0-Windows-Port (tporadowski) – für die genutzten Kommandos (INCR/EXPIRE/Pub-Sub) ausreichend, aber kein 1:1-Ersatz für Redis 7 aus docker-compose

## Auth – bewusst auf später verschoben (Stand Phase 1)

- **E-Mail-Verifizierung & Passwort-Reset:** braucht E-Mail-Versand (SMTP-Anbieter); bis dahin sind E-Mail-Adressen unbestätigt
- ~~Rate-Limiting für Login/Register~~ ✓ mit Phase 2 erledigt (`RateLimitGuard`, Redis Fixed-Window pro IP); weitere Endpunkte bei Bedarf nachziehen
- **Session-Übersicht** („angemeldete Geräte“ + einzeln abmelden): Datenmodell (RefreshToken pro Gerät) ist vorbereitet
- **2FA/TOTP:** sinnvoll ab echtem Mehrbenutzer-Betrieb
- Refresh-Token-Karenzzeit (60 s) für parallele Tabs: Standard-Praxis, aber dokumentiert, falls das Fenster später enger werden soll

## Branding & Rechtliches

- **„Parley“ ist Arbeitstitel** – endgültiger Name, Logo und Design stehen aus; spätestens vor Zugriff über den Freundeskreis hinaus entscheiden (CLAUDE.md Abschnitt 9)
- DSGVO-Themen (Datenschutzerklärung, AV-Vertrag, Löschkonzept) vor einem öffentlichen Betrieb klären – ggf. mit fachlichem/rechtlichem Rat

## Ideen aus der Entwicklung

- (hier während der Phasen ergänzen)
