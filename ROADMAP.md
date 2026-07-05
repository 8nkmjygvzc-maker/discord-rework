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

- Docker-Compose-Verifikation steht aus (Docker Desktop war bei Phase 0 nicht installiert)
- Vitest noch nicht eingerichtet (kommt mit Phase 1, sobald es testbare Logik gibt)
- `@parley/shared` wird als CommonJS gebaut; falls später Browser-Bundlegröße/ESM-Interop drückt, auf Dual-Build (ESM+CJS) umstellen
- npm 10.9.8 gebündelt mit Node 22 – Update auf npm 11 optional

## Branding & Rechtliches

- **„Parley“ ist Arbeitstitel** – endgültiger Name, Logo und Design stehen aus; spätestens vor Zugriff über den Freundeskreis hinaus entscheiden (CLAUDE.md Abschnitt 9)
- DSGVO-Themen (Datenschutzerklärung, AV-Vertrag, Löschkonzept) vor einem öffentlichen Betrieb klären – ggf. mit fachlichem/rechtlichem Rat

## Ideen aus der Entwicklung

- (hier während der Phasen ergänzen)
