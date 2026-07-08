# @parley/voice – mediasoup-SFU (Phase 10)

Selektiver Forwarding-Unit-Dienst (SFU) für Sprach- (und später Video-)Chat.
Läuft als **eigenständiger Node-Prozess** neben der API, damit Medien separat
skaliert werden können (CLAUDE.md §4).

## Aufgabenteilung

Sprachchat hat zwei getrennte Signaling-Ebenen:

| Ebene                                                                     | Transport                  | Verantwortlich                 |
| ------------------------------------------------------------------------- | -------------------------- | ------------------------------ |
| **Roster / State** (beitreten/verlassen, Mute/Deafen, „wer ist im Kanal") | REST + bestehendes Gateway | **API** (`apps/api/src/voice`) |
| **Medien** (WebRTC-Transporte, Produce/Consume)                           | direkte WebSocket zum SFU  | **dieser Dienst**              |

Die API ist die Autorität für den Roster (`VoiceSession`-Tabelle) und verteilt
ihn per `VOICE_STATE_UPDATE` an die Server-Mitglieder. Dieser Dienst kennt keine
Datenbank – er vertraut dem **Voice-Token** (kurzlebiges JWT, von der API beim
Beitritt signiert; enthält `userId`, `username`, `channelId`, `purpose:'voice'`).

## Ablauf

```
Client                         API                         SFU (dieser Dienst)
  │  POST /api/voice/…/join      │                            │
  │─────────────────────────────▶│ Rechte prüfen, Session,     │
  │  { voiceToken, voiceUrl }     │ VOICE_STATE_UPDATE broadcast│
  │◀─────────────────────────────│                            │
  │  WS /voice  { op:'auth', token }                          │
  │──────────────────────────────────────────────────────────▶│ Token prüfen
  │  { op:'welcome', peerId }                                  │
  │◀──────────────────────────────────────────────────────────│
  │  getRtpCapabilities → createTransport(send/recv)          │
  │  → connectTransport → produce (Mikro) → consume (andere)  │
  │◀────────── newProducer / producerClosed / peerLeft ───────│
```

Bei WS-Close meldet der SFU dem API-Roster den Weggang über den Redis-Kanal
`voice:disconnect` – so bleibt der Roster auch bei Client-Abstürzen konsistent.

Medien sind **transportverschlüsselt** (DTLS-SRTP zwischen Client und SFU).
Echte Medien-E2EE (Insertable Streams) steht in der ROADMAP.

## Architektur

- **Ein mediasoup-Worker** (C++-Subprozess, vorgebautes Binary – kein Compiler
  nötig). Für mehr Last: mehrere Worker + Router-Piping (ROADMAP).
- **Ein Router pro Sprachkanal** (`Room`), angelegt beim ersten Beitritt,
  geschlossen wenn leer.
- **Ein Peer pro Medien-WS** mit je einem Send- und Recv-Transport.
- Codecs: Opus (Audio). Video/VP8 kommt in Phase 11 (in `mediasoup-manager.ts`
  ergänzen – der Rest bleibt unverändert).

Dateien: `config.ts` (Env), `mediasoup-manager.ts` (Worker + Räume),
`room.ts` (Room/Peer), `signaling.ts` (WS-Protokoll), `main.ts` (HTTP + Health).

## Starten

```bash
npm run dev -w @parley/voice     # tsx watch (Dev)
npm run build -w @parley/voice   # tsc → dist/
npm run start -w @parley/voice   # node dist/main.js
```

Der Dienst lauscht auf `VOICE_PORT` (Default 3002): `GET /health` und die
Signaling-WS unter `/voice`. Im Dev proxyt Vite `/voice` an `ws://localhost:3002`.

## Konfiguration (.env)

| Variable                          | Default                  | Zweck                                                  |
| --------------------------------- | ------------------------ | ------------------------------------------------------ |
| `VOICE_PORT`                      | `3002`                   | Port der Signaling-WS                                  |
| `VOICE_PUBLIC_URL`                | `/voice`                 | URL, die die API dem Client nennt (Dev: Vite-Proxy)    |
| `JWT_SECRET`                      | –                        | gemeinsam mit der API (Voice-Token-Verifikation)       |
| `REDIS_URL`                       | `redis://localhost:6379` | `voice:disconnect`-Meldungen an die API                |
| `MEDIASOUP_LISTEN_IP`             | `127.0.0.1`              | Lausch-IP von mediasoup (`0.0.0.0` für alle)           |
| `MEDIASOUP_ANNOUNCED_IP`          | –                        | von außen erreichbare IP für ICE (LAN/Server setzen!)  |
| `MEDIASOUP_MIN_PORT` / `MAX_PORT` | `40000` / `40100`        | UDP/TCP-Portbereich der Medienströme (Firewall öffnen) |

> **LAN/Server:** Ohne `MEDIASOUP_ANNOUNCED_IP` finden Clients außerhalb von
> `localhost` den SFU nicht. Auf die von außen erreichbare IP setzen und den
> Portbereich in der Firewall freigeben.
