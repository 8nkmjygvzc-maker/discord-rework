# ROADMAP – zurückgestellte Punkte, Schulden, Ideen

> Laufend gepflegt (siehe CLAUDE.md Abschnitt 8). Nichts hier ist vergessen – nur bewusst verschoben.

## Zurückgestellte Features

- **Multi-Device-Support:** v1 startet mit einem Gerät pro Account; Geräte-Verknüpfung wie bei Signal/WhatsApp später (CLAUDE.md Abschnitt 6)
- **Serverseitige Volltextsuche:** wegen E2EE prinzipbedingt nicht möglich; v1 sucht nur clientseitig in entschlüsselten Nachrichten
- **Voice/Video-E2EE:** Voice läuft zunächst nur transportverschlüsselt (TLS/DTLS-SRTP über SFU), echte E2EE (z. B. Insertable Streams) später
- **Native Clients / Desktop-App:** perspektivisch, u. a. wegen des Web-E2EE-Trade-offs (s. u.)

## Offene Sicherheits-Trade-offs

- **Web-E2EE-Grundproblem:** Der Server liefert den Krypto-Code als JavaScript aus; ein kompromittierter Server könnte manipulierten Code ausliefern. Milderungen später: Subresource Integrity, signierte Builds, native Clients (CLAUDE.md Abschnitt 6)
- **Trust on first use (Phase 6):** Clients vertrauen den Schlüsselbündeln, die der Server ausliefert – ein kompromittierter Server könnte Bundles austauschen (MITM). Milderung später: Fingerprint-/“Safety-Number“-Verifikation in der UI, wie bei Signal
- **X3DH ohne One-Time-Prekeys (Phase 6):** bewusst der in der Signal-Spezifikation dokumentierte Fallback-Modus; OPKs (bessere Forward Secrecy für die ERSTE Nachricht einer Session) später ergänzen (Server-Endpunkt zum Nachfüllen + Verbrauch beim Abruf)
- **Sender-Key-Rotation ist Best-Effort (Phase 6):** Rotiert wird, wenn der Client ein `SERVER_MEMBER_REMOVE` live sieht. Wer beim Austritt offline war, rotiert nicht (der Ausgetretene erhält zwar weder Events noch History vom Server, könnte aber bei einem späteren DB-Leak mit seinem alten Schlüssel mitlesen). Fix-Idee: Mitglieder-Abgleich beim Reconnect oder serverseitiges Rotations-Signal
- **Sender-Keys gehen an ALLE Server-Mitglieder,** auch ohne ViewChannels (Ciphertext-Zugriff sperrt der Server). Solange Rechte serverweit gelten unkritisch – bei Kanal-Overwrites (s. u.) neu bewerten
- **Schlüsselmaterial liegt unverschlüsselt in IndexedDB** (wie z. B. bei Signal Desktop auf der Platte). Passphrase-Schutz/Key-Backup wäre ein eigenes Feature – zusammen mit Multi-Device betrachten
- **DM-E2EE nutzt den Sender-Key-Ratchet, nicht das reine Double Ratchet (Phase 7):** CLAUDE.md §6 sah für 1:1-Chats ein Double-Ratchet-Protokoll pro Nachricht vor. Umgesetzt sind DMs stattdessen wie Kanäle (Sender-Key-Kette pro Teilnehmer, verteilt über die X3DH+Double-Ratchet-Sessions). Grund: Der Client speichert Klartexte bewusst NIE lokal – History muss nach jedem Reload aus dem Server-Ciphertext neu entschlüsselbar sein, was mit einem reinen Double Ratchet (Zustand wandert unumkehrbar vorwärts) nicht geht. Die Kette liefert weiterhin einen neuen symmetrischen Schlüssel pro Nachricht (Forward Secrecy über den gespeicherten frühesten Stand hinaus allerdings nicht) und kein per-Nachricht-DH (schwächere Post-Compromise-Security als echtes Double Ratchet). Echtes Double Ratchet für DMs wird sinnvoll, sobald ein lokaler Nachrichtenspeicher existiert (zusammen mit Multi-Device betrachten)
- Dev-Standardpasswörter in `docker-compose.yml`-Defaults (`parley_dev_password`) – nur für lokale Entwicklung; vor jedem echten Deployment durch Secrets ersetzen

## Technische Schulden / Vereinfachungen

- `@parley/shared` wird als CommonJS gebaut; der Web-Client umgeht das per Vite-Alias direkt auf die TS-Quelle (Rollup kann CJS-Enum-Re-Exports nicht statisch auflösen). Falls das später stört: Dual-Build (ESM+CJS)
- npm 10.9.8 gebündelt mit Node 22 – Update auf npm 11 optional
- ~~Docker-Compose-Verifikation~~ ✓ nachgeholt (05.07.2026), ~~Vitest-Setup~~ ✓ mit Phase 1 erledigt
- **Presence-Edge-Case:** Stürzt eine Gateway-Instanz hart ab, wird kein `PRESENCE_UPDATE offline` publiziert – der Redis-TTL (60 s) räumt den Zähler auf und `getOnlineUsers()` entfernt Leichen lazy, aber bereits verbundene Clients sehen den Nutzer bis zum nächsten READY-Snapshot als online. Fix-Idee: Redis-Keyspace-Notifications oder periodischer Abgleich
- **Presence-Snapshot skaliert linear** (`HGETALL presence:users` + EXISTS-Pipeline): Das ROUTING ist seit Phase 7 auf den Sichtbarkeitskreis beschränkt, aber `getOnlineUsers()` lädt weiterhin ALLE Online-Nutzer und filtert danach – bei sehr vielen Nutzern auf gezielte Abfragen umstellen
- **Stale Presence-Einträge im Client:** Schrumpft der Sichtbarkeitskreis (Entfreunden, Server-Austritt), bleibt der Nutzer bis zum nächsten Reconnect im `onlineUsers`-Store des Clients (keine UI zeigt ihn an, aber der Eintrag lebt). Fix-Idee: gezieltes PRESENCE_REMOVE-Event oder Abgleich bei FRIENDS_UPDATE/SERVER_MEMBER_REMOVE
- **`trust proxy`** ist in Express nicht gesetzt – `req.ip` ist hinter einem Reverse-Proxy die Proxy-IP. Vor echtem Deployment setzen, sonst drosselt das Rate-Limit alle Nutzer gemeinsam
- **Dev-Infra ohne Docker:** Auf Maschinen ohne Docker Desktop laufen PostgreSQL/Redis/MinIO portabel (`scripts/dev-infra.ps1`); Redis ist dort ein 5.0-Windows-Port (tporadowski) – für die genutzten Kommandos (INCR/EXPIRE/Pub-Sub) ausreichend, aber kein 1:1-Ersatz für Redis 7 aus docker-compose
- **Sender-Key-Verteilung skaliert linear (Phase 6):** Beim Senden wird pro Mitglied das Schlüsselbündel geprüft (60-s-Cache) und bei Bedarf ein Umschlag verschickt – bei sehr großen Servern viele Requests. Später: `DEVICE_KEYS_CHANGED`-Gateway-Event statt Polling, Umschläge bündeln
- ~~Umschläge an beliebige Nutzer~~ ✓ mit Phase 7 erledigt: `POST /api/envelopes` UND `GET /users/:id/keys` verlangen jetzt den Sichtbarkeitskreis (Freunde, gemeinsame Server, bestehende DMs); 404 statt 403 gegen Nutzer-Enumeration
- **Skipped-Message-Keys im Double Ratchet** werden pro Kettenwechsel begrenzt (MAX_SKIP), aber nie global aufgeräumt – bei sehr langlebigen Sessions irgendwann beschneiden (Signal löscht nach Zeit/Anzahl)
- **E2EE-Testnutzer:** Die Verifikationsläufe von Phase 6 haben `charlie_…`-Wegwerf-Nutzer in der Dev-DB hinterlassen (Testserver wurden gelöscht; einen User-Lösch-Endpunkt gibt es noch nicht – kommt spätestens mit dem DSGVO-Löschkonzept)

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

- **Ownership-Übergabe:** Der Owner kann seinen Server aktuell nur löschen, nicht übergeben; „Server verlassen“ ist für Owner gesperrt. Übergabe-Flow sinnvoll ab Phase 13 (Moderation)
- **Rollen-Hierarchie fehlt bewusst (Phase 5):** Jeder mit ManageRoles kann jede Rolle bearbeiten/zuweisen – auch sich selbst höhere Rechte geben (inkl. Administrator). Discord löst das über Rollen-Positionen („nur Rollen unterhalb der eigenen verwalten“). Vor echtem Mehrbenutzer-Betrieb nachziehen; `position`-Feld existiert bereits
- **Kanal-spezifische Berechtigungen (Overwrites)** und private Kanäle (`isPrivate` ist bislang nur ein Flag ohne Wirkung) – späteres Feature
- **Gateway-Events vs. ViewChannels:** `MESSAGE_CREATE` geht seit Phase 5 nur an Mitglieder mit ViewChannels (`getMemberIdsWithPermission`); Struktur-Events (`CHANNEL_*`, `ROLE_*`, `SERVER_MEMBER_*`) gehen weiterhin an alle Mitglieder – unkritisch, solange Rechte nur serverweit gelten, bei Kanal-Overwrites neu bewerten
- **UI-Feinschliff Rollen:** Rollenfarben wirken bisher nur auf Badges im Mitglieder-Panel, nicht auf Namen im Chat
- **Beitritt per Server-ID** (Phase 3) ist bewusst primitiv – jeder mit der ID kann beitreten. Phase 12 ersetzt das durch Invite-Links mit Ablauf/Limit; danach den offenen Join-Endpunkt absichern oder entfernen
- **Nachrichten bearbeiten/löschen:** Datenmodell ist vorbereitet (`editedAt`), UI/Endpunkte fehlen noch – sinnvoll zusammen mit Phase 9 (Reaktionen/Threads) oder 13 (Moderation: fremde Nachrichten löschen)
- **DM-Ungelesen-Anzeige fehlt (Phase 7):** Kommt eine DM an, während der Kanal nicht geöffnet ist, gibt es keinen Badge/Hinweis – sinnvoll zusammen mit Phase 12 (Benachrichtigungen)
- **Blockieren lässt die DM-History lesbar (Phase 7, bewusste Entscheidung):** Eine Blockierung sperrt nur das SENDEN in beide Richtungen; bereits ausgetauschte Nachrichten bleiben für beide lesbar (wie bei Discord). Gruppen-DMs (mehr als zwei Teilnehmer) sind vorbereitet (`DmMember` ist n:m), aber bewusst nicht umgesetzt
- ~~Presence global statt gescoped~~ ✓ mit Phase 7 erledigt: READY-Snapshot und PRESENCE_UPDATE gehen nur noch an den Sichtbarkeitskreis (Freunde, gemeinsame Server, DM-Partner); PRESENCE_SYNC liefert additiv nach, wenn der Kreis wächst (Server-Beitritt, neue Freundschaft)
