# Projektauftrag: [PROJEKTNAME] – eigene, Ende-zu-Ende-verschlüsselte Discord-Alternative (Web)

> Hinweis für Arian: Diese Datei ist der Arbeitsauftrag für Claude Code, nicht zum Lesen als Endprodukt gedacht. Am besten in `CLAUDE.md` umbenennen und im Projekt-Hauptordner speichern, dann kennt Claude Code den Kontext automatisch in jeder neuen Session.

**Adressiert an:** Claude Code
**Ziel:** Ein komplett selbst entwickeltes, webbasiertes Chat-/Voice-/Video-Produkt im Funktionsumfang von Discord bauen. Eigenes Backend, eigenes Protokoll, echte Ende-zu-Ende-Verschlüsselung, ausgelegt auf viele gleichzeitige Nutzer. Kein Discord-Bot, keine Discord-API, kein Discord-Branding – ein eigenständiges System.

---

## 0. Realistische Erwartungshaltung

Dieses Dokument beschreibt den **vollen** Funktionsumfang – vergleichbar mit echtem Discord. Das ist ein Projekt für Wochen bis Monate, verteilt auf viele einzelne Arbeits-Sessions, kein Projekt, das in einer Antwort „fertig" wird. Zweck dieses Dokuments: Jede Session weiß genau, wo das Projekt steht und was als Nächstes drankommt – damit am Ende wirklich ein funktionierendes Produkt steht statt eines unvollständigen Sammelsuriums.

---

## 1. Rolle & Arbeitsweise (immer befolgen)

- Bearbeite **immer nur eine Phase** aus Abschnitt 7 pro Anlauf – auch wenn hier der komplette Funktionsumfang beschrieben ist.
- Lies zu Beginn jeder Session zuerst `PROGRESS.md` (falls vorhanden), um zu sehen, was fertig ist und was als Nächstes ansteht. Existiert die Datei noch nicht: anlegen.
- Vor einer Phase: in 3–5 Sätzen ankündigen, was gebaut wird und warum.
- Nach einer Phase: kurze Zusammenfassung geben, erklären wie man das Ergebnis startet/testet, `PROGRESS.md` aktualisieren, die nächste Phase benennen – dann **stoppen** und auf Bestätigung warten, nicht automatisch weitermachen.
- Bei unklaren Architekturentscheidungen (z. B. Multi-Device-Handling, siehe Abschnitt 6): nachfragen statt raten.
- Code-Qualität: TypeScript strict mode, modulare Struktur, Kommentare bei nicht-trivialer Logik, README pro Teilprojekt aktuell halten.
- Keine Secrets im Code, `.env`-Dateien nutzen, Passwörter/Schlüssel nie loggen.
- Nach jeder verifizierten Phase: einen Git-Commit vorschlagen.
- Auch wenn der Wunsch aufkommt, mehrere Phasen gleichzeitig anzugehen: nicht tun. Kleine, verifizierte Schritte kommen bei einem Projekt dieser Größe schneller zum Ziel als große Sprünge.

---

## 2. Vision – was am Ende stehen soll

- Server/Communities mit mehreren Text- und Sprach-/Video-Kanälen
- Granulares Rollen- & Berechtigungssystem
- Direktnachrichten & Freundesystem
- Reaktionen, Threads, Erwähnungen, Anhänge, Suche
- Sprach-/Videochat und Bildschirmfreigabe
- Einladungslinks
- Moderationswerkzeuge (Kick/Bann/Timeout, Audit-Log)
- Push-/Browser-Benachrichtigungen, Anwesenheitsstatus
- Ende-zu-Ende-Verschlüsselung für Nachrichten (perspektivisch auch Voice/Video)
- Architektur für horizontale Skalierung auf viele gleichzeitige Nutzer
- Eigenständiges Produkt: eigener Name, eigenes Branding, eigenes Protokoll – keine Discord-API, kein Bot, keine Discord-Markenzeichen

---

## 3. Tech-Stack (verbindlich, um Zeit zu sparen – änderbar, aber dann diesen Abschnitt vorher anpassen)

| Bereich | Wahl | Warum |
|---|---|---|
| Sprache | TypeScript (Frontend + Backend) | ein Typsystem für das ganze Projekt |
| Backend-Framework | NestJS | erzwingt von Anfang an modulare Struktur – wichtig bei diesem Umfang |
| Echtzeit-Gateway | natives WebSocket (`ws`) mit eigenem Opcode-Protokoll + Redis Pub/Sub | volle Kontrolle, horizontal über mehrere Instanzen skalierbar |
| Datenbank | PostgreSQL + Prisma ORM | robust bei stark verknüpften Daten (Server/Rollen/Mitglieder), typsicher |
| Cache/Presence | Redis | Online-Status, Rate-Limiting, Pub/Sub zwischen Instanzen |
| Objektspeicher | S3-kompatibel (MinIO selbst gehostet) | Dateien/Bilder getrennt von der DB |
| Voice/Video/Screen-Share | mediasoup (Node.js SFU) | Mesh-WebRTC skaliert nicht auf „viele Nutzer" |
| Frontend | React + TypeScript + Vite, Zustand, TailwindCSS | großes Ökosystem, gut für Echtzeit-UIs |
| Verschlüsselung | libsodium (`libsodium-wrappers`) | geprüfte Krypto-Bausteine statt eigener Kryptographie |
| Deployment | Docker Compose (Start), Struktur Kubernetes-fähig | einfacher Einstieg, Skalierung nicht verbaut |
| Tests | Vitest | einheitlich für Front- und Backend |

---

## 4. Architektur-Überblick

Monorepo-Struktur:

```
/apps
  /web        React-Frontend
  /api        NestJS REST-API + WebSocket-Gateway
  /voice      mediasoup-SFU-Service
/packages
  /shared     gemeinsame Typen, Opcode-Definitionen, Krypto-Utils
/infra
  docker-compose.yml
```

Datenfluss (vereinfacht):

```
Client (React)
  ⇄ REST-API         (Login, Server-/Kanal-CRUD, Rollen)
  ⇄ WS-Gateway        (Nachrichten in Echtzeit, Presence) ⇄ Redis Pub/Sub ⇄ weitere Gateway-Instanzen
  ⇄ mediasoup-Service (Voice/Video/Screen-Share, separat skalierbar)
Alle Dienste ⇄ PostgreSQL / Redis / Objektspeicher
```

Starte als **modularer Monolith** innerhalb von NestJS (ein Backend-Service, sauber in Module aufgeteilt: Auth, Users, Servers, Channels, Messages, Roles, Voice-Signaling). Erst bei echtem Skalierungsbedarf (Phase 14) in echte Microservices aufteilen. Das hält Phase 1–13 überschaubar.

---

## 5. Kern-Datenmodell (Ausgangspunkt, darf erweitert werden)

- **User**: id, username, email, passwordHash, publicIdentityKey, avatarUrl, status, createdAt
- **Device**: id, userId, devicePublicKey, lastSeenAt (Multi-Device/Schlüssel-Verwaltung)
- **Server**: id, name, ownerId, iconUrl, createdAt
- **Membership**: userId, serverId, nickname, joinedAt, roleIds
- **Role**: id, serverId, name, permissionsBitfield, color, position
- **Channel**: id, serverId (nullable bei DMs), type (text/voice/video/dm), name, position, isPrivate
- **Message**: id, channelId, senderId, ciphertext, nonce, createdAt, editedAt
- **Attachment**: id, messageId, encryptedFileUrl, mimeType, sizeBytes
- **Friendship**: userId, friendId, status (pending/accepted/blocked)
- **Invite**: id, serverId, code, createdBy, expiresAt, maxUses
- **VoiceSession**: id, channelId, userId, sfuPeerId, joinedAt
- **AuditLogEntry**: id, serverId, actorId, action, targetId, createdAt

---

## 6. Sicherheit & Verschlüsselung

- Passwort-Hashing: **Argon2id**, nie Klartext oder unsalted Hashes.
- Transport: ausschließlich TLS/WSS.
- Rate-Limiting (über Redis) gegen Spam/Missbrauch – wichtig bei vielen/fremden Nutzern.
- **Schlüsselaustausch:** Jedes Gerät generiert bei Registrierung ein Identitätsschlüsselpaar (X25519) plus signierte Prekeys, angelehnt an X3DH aus dem Signal-Protokoll. Der Server speichert nur öffentliche Schlüssel.
- **1:1-Chats:** Double-Ratchet-artiges Protokoll (neuer symmetrischer Schlüssel pro Nachricht → Forward Secrecy).
- **Gruppen-/Server-Kanäle:** Sender-Key-Ratchet – jedes Mitglied hat einen eigenen, fortlaufend rotierenden Sende-Schlüssel, verteilt über die 1:1-Ratchets an neue Mitglieder (ähnliches Prinzip wie Megolm bei Matrix).
- **Bibliothek:** libsodium (`libsodium-wrappers`) für alle kryptographischen Primitiven. Keine eigenen Algorithmen erfinden – nur geprüfte Bausteine kombinieren.
- Der Server speichert/leitet ausschließlich Ciphertext plus technische Metadaten (Absender, Kanal, Zeitstempel) weiter – er kann Inhalte prinzipbedingt nicht lesen.

**Wichtiger, ehrlicher Trade-off bei einer Web-App:** Der Server liefert bei jedem Aufruf den JavaScript-Code aus, der die Verschlüsselung durchführt. Ein kompromittierter Server könnte theoretisch einmalig manipulierten Code ausliefern und Schlüssel abgreifen. Das ist eine bekannte, branchenweite Einschränkung von Web-basiertem E2EE (kein Sonderfall dieses Projekts) – sie macht die Verschlüsselung nicht wertlos (schützt weiterhin gegen reines Mitlesen von DB/Traffic durch Dritte), ist aber keine 100-%-Garantie wie bei einer signierten, nativen App. Für den Anfang ein akzeptabler Kompromiss, in `ROADMAP.md` (Abschnitt 8) als bekannten Punkt vermerken (z. B. Subresource-Integrity, später ggf. native Clients).

**Offene Design-Entscheidungen, bewusst nicht vorab festgelegt:**
- Multi-Device-Support (v1 kann mit einem Gerät pro Account starten, Geräte-Verknüpfung wie bei Signal/WhatsApp später)
- Volltextsuche ist wegen E2EE serverseitig nicht möglich – v1 sucht nur clientseitig in bereits entschlüsselten Nachrichten

---

## 7. Phasenplan

### Phase 0 – Setup
Monorepo-Grundgerüst, Tooling (ESLint/Prettier), Docker-Compose mit Postgres/Redis/MinIO, leeres NestJS- und React-Projekt.
*Verifizieren:* `docker compose up` startet alles, Frontend erreicht Backend-`/health`.

### Phase 1 – Auth & Nutzerverwaltung
Registrierung, Login, Access-/Refresh-Token, Argon2id-Hashing, Profilseite.
*Nicht:* Rollen, Verschlüsselung.
*Verifizieren:* Registrierung + Login funktionieren Ende-zu-Ende über die UI.

### Phase 2 – Echtzeit-Gateway
WebSocket-Verbindung mit eigenem Opcode-Protokoll (strukturell angelehnt an öffentlich dokumentierte Gateway-Konzepte, nicht an fremden Code), Heartbeat, Redis-Pub/Sub für mehrere Instanzen, Online-Status.
*Verifizieren:* Zwei Tabs sehen sich gegenseitig als online.

### Phase 3 – Server & Kanäle
CRUD für Server und Text-Kanäle, Mitgliederliste, beitreten/verlassen.
*Verifizieren:* Server + Kanal anlegen, zweiter Nutzer tritt bei – sichtbar in der UI.

### Phase 4 – Basis-Text-Chat (noch unverschlüsselt)
Nachrichten senden/empfangen/History – bewusst zuerst Klartext, um die technische Pipeline zu verifizieren, bevor Verschlüsselung dazukommt.
*Verifizieren:* Nachricht kommt in Echtzeit bei allen Mitgliedern an, History lädt nach Reload.

### Phase 5 – Rollen & Berechtigungen
Rollenverwaltung, Berechtigungs-Bitfield, Zuweisung pro Mitglied, serverseitige Durchsetzung.
*Verifizieren:* Nutzer ohne Schreibrecht wird vom **Server** blockiert, nicht nur von der UI versteckt.

### Phase 6 – Ende-zu-Ende-Verschlüsselung
Schlüsselgenerierung, Schlüsselaustausch, Double-Ratchet (DMs) und Sender-Key-Ratchet (Kanäle), Klartext aus Phase 4 ersetzen.
*Verifizieren:* In der Datenbank sind nur Ciphertexts sichtbar, Clients können trotzdem lesbar kommunizieren.
*Hinweis:* kryptographisch anspruchsvollste Phase – bei Unsicherheit lieber stoppen und den Ansatz kurz erklären, statt eine unsichere Vereinfachung einzubauen.

### Phase 7 – Direktnachrichten & Freunde
1:1-Chats unabhängig von Servern, Freundschaftsanfragen/-status.

### Phase 8 – Datei-/Bild-Uploads
Verschlüsselte Anhänge über MinIO, Vorschaubilder.

### Phase 9 – Reaktionen, Threads, Erwähnungen, Suche
Emoji-Reaktionen, Antwort-Threads, @Erwähnungen mit Benachrichtigung, clientseitige Suche.

### Phase 10 – Sprachchat
mediasoup-Integration, Sprachkanäle beitreten/verlassen, Mute/Deafen.

### Phase 11 – Video & Bildschirmfreigabe
Video-Streams und Screen-Share über dieselbe mediasoup-Infrastruktur.

### Phase 12 – Benachrichtigungen & Einladungen
Browser-Push-Benachrichtigungen, Invite-Links mit Ablaufdatum/Nutzungslimit.

### Phase 13 – Moderationswerkzeuge
Kick/Bann/Timeout, Audit-Log für moderative Aktionen.

### Phase 14 – Skalierungs-Härtung
Lasttests, horizontale Skalierung von Gateway- und Voice-Instanzen prüfen, DB-Indizes optimieren, ggf. Message-Queue (z. B. NATS) für sehr große Last vorbereiten.

### Phase 15 – Feinschliff
Fehlerbehandlung/Edge-Cases, Onboarding-UI, Performance-Politur, `ROADMAP.md` finalisieren.

---

## 8. ROADMAP.md – laufend pflegen

Von Anfang an anlegen und laufend ergänzen mit:
- zurückgestellten Features (z. B. Multi-Device-Sync, verschlüsselte Server-Suche, Voice-E2EE)
- bekannten technischen Vereinfachungen/Schulden
- eigenen Verbesserungsideen, die während der Entwicklung entstehen
- offenen Sicherheits-Trade-offs (siehe Abschnitt 6)

So bleibt das gewünschte Verbesserungspotenzial dokumentiert statt verloren zu gehen.

---

## 9. Branding & Rechtliches

- Eigener Name, eigenes Logo, eigenes Design – keine Übernahme von „Discord"-Name, -Logo oder -Markenzeichen, spätestens relevant sobald mehr als der private Freundeskreis Zugriff hat.
- Bei echtem Betrieb mit vielen/fremden Nutzern in Deutschland/der EU wird Datenschutz (DSGVO) relevant – u. a. Datenschutzerklärung, Auftragsverarbeitung beim Hosting, Löschkonzept. Das ist keine rein technische Aufgabe mehr; vor einem öffentlichen Launch lohnt sich fachlicher/rechtlicher Rat (keine Rechtsberatung an dieser Stelle). Für Aufbau und Testbetrieb im kleinen Kreis unkritisch – als Punkt in `ROADMAP.md` festhalten.

---

## 10. „Fertig"-Kriterien pro Phase

Eine Phase gilt erst als abgeschlossen, wenn:
- der Code fehlerfrei baut
- die neue Funktionalität lokal gestartet und überprüft wurde (manuell oder per Test)
- README/Doku ergänzt wurde
- `PROGRESS.md` aktualisiert ist
- keine sicherheitsrelevanten TODOs/Platzhalter offen sind
