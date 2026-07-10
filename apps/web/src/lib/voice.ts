import { Device, types } from 'mediasoup-client';
import type { VoiceProducerInfo, VoiceServerMessage, VoiceSource } from '@parley/shared';

/**
 * Browser-seitige Voice-Anbindung (Phase 10/11). Kapselt die mediasoup-client-
 * Logik: WebSocket zum SFU, Device laden, Send-/Recv-Transporte, eigene
 * Producer (Mikrofon, Kamera, Bildschirm) und das Konsumieren der anderen
 * Teilnehmer. Der Store (store/voice.ts) orchestriert Beitritt/Verlassen/Mute
 * und die Video-Umschalter; diese Klasse macht ausschließlich die Medien.
 *
 * Ohne funktionierendes Mikrofon (Berechtigung verweigert / kein Gerät) wird
 * NUR zugehört (kein Mikro-Producer) – man ist trotzdem im Kanal, nur stumm.
 * Kamera und Bildschirmfreigabe sind optional und werden erst auf Wunsch aktiv.
 */

/** Ein anzuzeigender Video-Stream (eigener oder fremder) für die Video-Bühne. */
export interface VideoTile {
  /** Stabiler React-Key (consumerId bei fremden, 'local-cam'/'local-screen' bei eigenen). */
  id: string;
  userId: string;
  username: string;
  /** 'cam' = Kamera, 'screen' = Bildschirmfreigabe (Audio erzeugt keine Kachel). */
  source: Exclude<VoiceSource, 'mic'>;
  /** true = eigener Stream (wird gespiegelt/stummgeschaltet dargestellt). */
  isLocal: boolean;
  track: MediaStreamTrack;
}

interface VoiceCallbacks {
  /** Der lokale Nutzer (für die Beschriftung eigener Video-Kacheln). */
  self: { userId: string; username: string };
  /** Verbindung unerwartet geschlossen (z. B. SFU weg) → Store räumt auf. */
  onClosed: () => void;
  /** Video-Kacheln (lokal + fremd) haben sich geändert. */
  onTilesChanged: (tiles: VideoTile[]) => void;
  /**
   * Ein eigener Video-Track ist von selbst beendet worden (z. B. „Freigabe
   * beenden“ im Browser oder Gerät entfernt) → Store aktualisiert das Roster.
   */
  onLocalVideoEnded: (source: 'cam' | 'screen') => void;
  /** Sprech-Erkennung: Nutzer hat angefangen/aufgehört zu sprechen (Phase 15). */
  onSpeakingChanged: (userId: string, speaking: boolean) => void;
}

/**
 * Sprech-Erkennung per WebAudio (Phase 15): misst den RMS-Pegel eines
 * Audio-Tracks (eigenes Mikrofon oder fremder Consumer) über einen AnalyserNode
 * und meldet Übergänge spricht/spricht-nicht. Schwelle mit Haltezeit gegen
 * Flackern bei kurzen Sprechpausen. Läuft rein clientseitig – der SFU wird
 * nicht gefragt (kein AudioLevelObserver nötig).
 */
const SPEAKING_RMS_THRESHOLD = 0.015; // ≈ −36 dBFS – leise Sprache liegt darüber
const SPEAKING_HOLD_MS = 500; // so lange bleibt „spricht“ nach dem letzten Pegel stehen
const SPEAKING_POLL_MS = 120;

export class SpeakingDetector {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  // Explizit <ArrayBuffer>: getFloatTimeDomainData akzeptiert kein SharedArrayBuffer-Backing.
  private readonly buf: Float32Array<ArrayBuffer>;
  private readonly timer: number;
  private lastLoudAt = 0;
  private speaking = false;
  private enabled = true;

  constructor(
    ctx: AudioContext,
    track: MediaStreamTrack,
    private readonly onChange: (speaking: boolean) => void,
  ) {
    this.source = ctx.createMediaStreamSource(new MediaStream([track]));
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.timer = window.setInterval(() => this.poll(), SPEAKING_POLL_MS);
  }

  /** false = Erkennung aussetzen (eigenes Mikro stumm) und „spricht“ löschen. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.lastLoudAt = 0;
      this.update(false);
    }
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.source.disconnect();
    this.update(false);
  }

  private poll(): void {
    if (!this.enabled) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const now = performance.now();
    if (rms >= SPEAKING_RMS_THRESHOLD) this.lastLoudAt = now;
    this.update(this.lastLoudAt !== 0 && now - this.lastLoudAt <= SPEAKING_HOLD_MS);
  }

  private update(speaking: boolean): void {
    if (speaking === this.speaking) return;
    this.speaking = speaking;
    this.onChange(speaking);
  }
}

let ridSeq = 1;

export class VoiceClient {
  private ws: WebSocket | null = null;
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private micProducer: types.Producer | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private camProducer: types.Producer | null = null;
  private camTrack: MediaStreamTrack | null = null;
  private screenProducer: types.Producer | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private readonly consumers = new Map<string, types.Consumer>();
  /** Ein verstecktes <audio>-Element pro Audio-Consumer (Wiedergabe der Ströme). */
  private readonly audioEls = new Map<string, HTMLAudioElement>();
  /** Fremde Video-Kacheln, Schlüssel = consumerId. */
  private readonly remoteVideo = new Map<string, VideoTile>();
  /** Metadaten der bekannten Producer (Quelle/Nutzer) – für das Konsumieren. */
  private readonly producerMeta = new Map<string, VoiceProducerInfo>();
  private readonly pending = new Map<
    number,
    { resolve: (d: unknown) => void; reject: (e: Error) => void }
  >();
  /** Sprech-Erkennung pro Audio-Quelle ('self' bzw. consumerId). */
  private readonly speakingDetectors = new Map<string, SpeakingDetector>();
  private audioCtx: AudioContext | null = null;
  private resumeHandler: (() => void) | null = null;
  private deafened = false;
  private closed = false;

  constructor(private readonly cb: VoiceCallbacks) {}

  /** true, wenn wir ein Mikrofon produzieren (sonst nur Zuhörer). */
  get hasMic(): boolean {
    return this.micProducer !== null;
  }

  async connect(voiceUrl: string, voiceToken: string): Promise<void> {
    const url = resolveWsUrl(voiceUrl);
    this.ws = new WebSocket(url);
    await this.waitOpen();
    this.ws.addEventListener('message', (ev) => this.onMessage(String(ev.data)));
    this.ws.addEventListener('close', () => {
      if (!this.closed) this.cb.onClosed();
    });

    // 1) Authentifizieren, auf welcome warten.
    this.ws.send(JSON.stringify({ op: 'auth', token: voiceToken }));
    await this.waitWelcome();

    // 2) Device mit den RTP-Capabilities des Routers laden.
    const routerRtpCapabilities = (await this.rpc('getRtpCapabilities')) as types.RtpCapabilities;
    this.device = new Device();
    await this.device.load({ routerRtpCapabilities });

    // 3) Transporte aufbauen.
    await this.createSendTransport();
    await this.createRecvTransport();

    // 4) Eigenes Mikrofon produzieren (best effort – sonst Zuhörer-Modus).
    await this.startMic();

    // 5) Bereits vorhandene Producer konsumieren.
    const { producers } = (await this.rpc('getProducers')) as { producers: VoiceProducerInfo[] };
    for (const p of producers) await this.consume(p);
  }

  /** Mikrofon stumm/laut schalten (pausiert den Producer und meldet es dem SFU). */
  async setMicPaused(paused: boolean): Promise<void> {
    if (!this.micProducer) return;
    if (paused) this.micProducer.pause();
    else this.micProducer.resume();
    // Pausieren stoppt den Track nicht – die Sprech-Erkennung explizit aussetzen,
    // sonst leuchtete man beim Reden trotz Stummschaltung als „spricht“ auf.
    this.speakingDetectors.get('self')?.setEnabled(!paused);
    try {
      await this.rpc(paused ? 'pauseProducer' : 'resumeProducer', {
        producerId: this.micProducer.id,
      });
    } catch {
      /* Best-effort – der lokale Pausenzustand zählt für die Übertragung. */
    }
  }

  /** Deafen: alle eingehenden Audio-Ströme stummschalten (lokal). */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const el of this.audioEls.values()) el.muted = deafened;
  }

  /** Kamera einschalten und als Video-Producer senden. Wirft bei Fehler. */
  async startCamera(): Promise<void> {
    if (this.camProducer || !this.sendTransport) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Keine Kamera gefunden');
    this.camTrack = track;
    this.camProducer = await this.sendTransport.produce({
      track,
      encodings: [{ maxBitrate: 600_000 }],
      appData: { source: 'cam' satisfies VoiceSource },
    });
    track.addEventListener('ended', () => this.onTrackEnded('cam'));
    this.emitTiles();
  }

  /** Kamera ausschalten (Producer schließen, andere sehen die Kachel verschwinden). */
  async stopCamera(): Promise<void> {
    await this.closeLocalProducer('cam');
    this.emitTiles();
  }

  /** Bildschirmfreigabe starten. Wirft bei Abbruch/Verweigerung durch den Nutzer. */
  async startScreenShare(): Promise<void> {
    if (this.screenProducer || !this.sendTransport) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Keine Bildschirmquelle gewählt');
    this.screenTrack = track;
    this.screenProducer = await this.sendTransport.produce({
      track,
      encodings: [{ maxBitrate: 2_500_000 }],
      appData: { source: 'screen' satisfies VoiceSource },
    });
    // Feuert beim „Freigabe beenden“-Button des Browsers → sauber aufräumen.
    track.addEventListener('ended', () => this.onTrackEnded('screen'));
    this.emitTiles();
  }

  /** Bildschirmfreigabe beenden. */
  async stopScreenShare(): Promise<void> {
    await this.closeLocalProducer('screen');
    this.emitTiles();
  }

  disconnect(): void {
    this.closed = true;
    for (const d of this.speakingDetectors.values()) d.stop();
    this.speakingDetectors.clear();
    this.removeResumeHandler();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.micTrack?.stop();
    this.camTrack?.stop();
    this.screenTrack?.stop();
    this.sendTransport?.close();
    this.recvTransport?.close();
    for (const el of this.audioEls.values()) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioEls.clear();
    this.consumers.clear();
    this.remoteVideo.clear();
    this.producerMeta.clear();
    this.ws?.close();
    this.ws = null;
  }

  // --- intern ---------------------------------------------------------------

  private async createSendTransport(): Promise<void> {
    const params = (await this.rpc('createTransport', { direction: 'send' })) as TransportParams;
    const transport = this.device!.createSendTransport(params);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.rpc('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((e: Error) => errback(e));
    });
    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      // Quelle (mic/cam/screen) aus appData an den SFU durchreichen.
      const source = (appData as { source?: VoiceSource }).source ?? 'mic';
      this.rpc('produce', { transportId: transport.id, kind, rtpParameters, source })
        .then((d) => callback({ id: (d as { producerId: string }).producerId }))
        .catch((e: Error) => errback(e));
    });
    this.sendTransport = transport;
  }

  private async createRecvTransport(): Promise<void> {
    const params = (await this.rpc('createTransport', { direction: 'recv' })) as TransportParams;
    const transport = this.device!.createRecvTransport(params);
    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.rpc('connectTransport', { transportId: transport.id, dtlsParameters })
        .then(() => callback())
        .catch((e: Error) => errback(e));
    });
    this.recvTransport = transport;
  }

  private async startMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.micTrack = stream.getAudioTracks()[0] ?? null;
      if (this.micTrack && this.sendTransport) {
        this.micProducer = await this.sendTransport.produce({
          track: this.micTrack,
          appData: { source: 'mic' satisfies VoiceSource },
        });
        this.attachSpeaking('self', this.micTrack, this.cb.self.userId);
      }
    } catch {
      // Kein Mikrofon/keine Berechtigung → Zuhörer-Modus. Nicht fatal.
      this.micProducer = null;
      this.micTrack = null;
    }
  }

  /** Schließt einen eigenen Video-Producer serverseitig und lokal. */
  private async closeLocalProducer(source: 'cam' | 'screen'): Promise<void> {
    const producer = source === 'cam' ? this.camProducer : this.screenProducer;
    const track = source === 'cam' ? this.camTrack : this.screenTrack;
    if (source === 'cam') {
      this.camProducer = null;
      this.camTrack = null;
    } else {
      this.screenProducer = null;
      this.screenTrack = null;
    }
    if (!producer) return;
    try {
      await this.rpc('closeProducer', { producerId: producer.id });
    } catch {
      /* Best-effort – lokal schließen wir ohnehin. */
    }
    producer.close();
    track?.stop();
  }

  /** Ein eigener Video-Track wurde extern beendet (Freigabe-Stopp / Gerät weg). */
  private onTrackEnded(source: 'cam' | 'screen'): void {
    void this.closeLocalProducer(source).finally(() => {
      this.emitTiles();
      this.cb.onLocalVideoEnded(source);
    });
  }

  private async consume(info: VoiceProducerInfo): Promise<void> {
    if (!this.recvTransport || !this.device) return;
    this.producerMeta.set(info.producerId, info);
    try {
      const data = (await this.rpc('consume', {
        producerId: info.producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      })) as {
        id: string;
        producerId: string;
        kind: types.MediaKind;
        rtpParameters: types.RtpParameters;
      };
      const consumer = await this.recvTransport.consume({
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
      });
      this.consumers.set(consumer.id, consumer);
      if (consumer.kind === 'video') {
        this.remoteVideo.set(consumer.id, {
          id: consumer.id,
          userId: info.userId,
          username: info.username,
          source: info.source === 'screen' ? 'screen' : 'cam',
          isLocal: false,
          track: consumer.track,
        });
        this.emitTiles();
      } else {
        this.playAudio(consumer.id, consumer.track);
        this.attachSpeaking(consumer.id, consumer.track, info.userId);
      }
      await this.rpc('resumeConsumer', { consumerId: consumer.id });
    } catch {
      /* Producer evtl. schon wieder weg – ignorieren. */
    }
  }

  private playAudio(consumerId: string, track: MediaStreamTrack): void {
    const el = document.createElement('audio');
    el.autoplay = true;
    el.muted = this.deafened;
    el.srcObject = new MediaStream([track]);
    el.style.display = 'none';
    document.body.appendChild(el);
    void el.play().catch(() => {
      /* Autoplay-Policy kann erst nach Nutzerinteraktion greifen. */
    });
    this.audioEls.set(consumerId, el);
  }

  /** Sprech-Erkennung an einen Audio-Track hängen (best effort, nie fatal). */
  private attachSpeaking(key: string, track: MediaStreamTrack, userId: string): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    try {
      const detector = new SpeakingDetector(ctx, track, (speaking) =>
        this.cb.onSpeakingChanged(userId, speaking),
      );
      this.speakingDetectors.set(key, detector);
    } catch {
      // Track nicht analysierbar → Indikator bleibt für diesen Nutzer einfach aus.
    }
  }

  /**
   * Gemeinsamer AudioContext für alle Pegelmesser. Die Autoplay-Policy kann ihn
   * ohne Nutzergeste suspendieren – dann wird beim nächsten Klick/Tastendruck
   * ein Resume nachgeholt (der Beitritt selbst ist zwar ein Klick, aber die
   * Geste kann durch die async-Kette bereits verfallen sein).
   */
  private ensureAudioContext(): AudioContext | null {
    if (this.closed) return null;
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
      } catch {
        return null; // Ohne WebAudio keine Sprech-Erkennung – nicht fatal.
      }
    }
    if (this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => undefined);
      if (!this.resumeHandler) {
        this.resumeHandler = () => {
          const ctx = this.audioCtx;
          if (!ctx || ctx.state !== 'suspended') {
            this.removeResumeHandler();
            return;
          }
          void ctx
            .resume()
            .then(() => this.removeResumeHandler())
            .catch(() => undefined);
        };
        document.addEventListener('pointerdown', this.resumeHandler);
        document.addEventListener('keydown', this.resumeHandler);
      }
    }
    return this.audioCtx;
  }

  private removeResumeHandler(): void {
    if (!this.resumeHandler) return;
    document.removeEventListener('pointerdown', this.resumeHandler);
    document.removeEventListener('keydown', this.resumeHandler);
    this.resumeHandler = null;
  }

  private closeConsumerByProducer(producerId: string): void {
    this.producerMeta.delete(producerId);
    let videoChanged = false;
    for (const [id, consumer] of this.consumers) {
      if (consumer.producerId !== producerId) continue;
      consumer.close();
      this.consumers.delete(id);
      const el = this.audioEls.get(id);
      if (el) {
        el.pause();
        el.srcObject = null;
        el.remove();
        this.audioEls.delete(id);
      }
      const detector = this.speakingDetectors.get(id);
      if (detector) {
        detector.stop(); // meldet ggf. speaking=false, bevor der Nutzer verschwindet
        this.speakingDetectors.delete(id);
      }
      if (this.remoteVideo.delete(id)) videoChanged = true;
    }
    if (videoChanged) this.emitTiles();
  }

  /** Baut die aktuelle Kachel-Liste (eigene + fremde Video-Streams) und meldet sie. */
  private emitTiles(): void {
    const tiles: VideoTile[] = [];
    if (this.camTrack) {
      tiles.push({
        id: 'local-cam',
        userId: this.cb.self.userId,
        username: this.cb.self.username,
        source: 'cam',
        isLocal: true,
        track: this.camTrack,
      });
    }
    if (this.screenTrack) {
      tiles.push({
        id: 'local-screen',
        userId: this.cb.self.userId,
        username: this.cb.self.username,
        source: 'screen',
        isLocal: true,
        track: this.screenTrack,
      });
    }
    for (const tile of this.remoteVideo.values()) tiles.push(tile);
    this.cb.onTilesChanged(tiles);
  }

  private onMessage(raw: string): void {
    let msg: VoiceServerMessage;
    try {
      msg = JSON.parse(raw) as VoiceServerMessage;
    } catch {
      return;
    }
    switch (msg.op) {
      case 'response':
        this.pending.get(msg.rid)?.resolve(msg.data);
        this.pending.delete(msg.rid);
        return;
      case 'error':
        this.pending.get(msg.rid)?.reject(new Error(msg.message));
        this.pending.delete(msg.rid);
        return;
      case 'newProducer':
        void this.consume(msg.producer);
        return;
      case 'producerClosed':
        this.closeConsumerByProducer(msg.producerId);
        return;
      default:
        // welcome/authError/peerLeft werden über die dedizierten Waiter behandelt.
        return;
    }
  }

  private rpc(op: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    const rid = ridSeq++;
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Voice-Verbindung nicht offen'));
        return;
      }
      this.pending.set(rid, { resolve, reject });
      this.ws.send(JSON.stringify({ op, rid, ...extra }));
      setTimeout(() => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          reject(new Error(`Voice-Anfrage ${op} ohne Antwort`));
        }
      }, 8000);
    });
  }

  private waitOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.ws!;
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('Voice-WS-Fehler')), { once: true });
    });
  }

  private waitWelcome(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kein welcome vom SFU')), 8000);
      const handler = (ev: MessageEvent): void => {
        let msg: VoiceServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as VoiceServerMessage;
        } catch {
          return;
        }
        if (msg.op === 'welcome') {
          clearTimeout(timer);
          this.ws!.removeEventListener('message', handler);
          resolve();
        } else if (msg.op === 'authError') {
          clearTimeout(timer);
          this.ws!.removeEventListener('message', handler);
          reject(new Error(msg.reason));
        }
      };
      this.ws!.addEventListener('message', handler);
    });
  }
}

interface TransportParams {
  id: string;
  iceParameters: types.IceParameters;
  iceCandidates: types.IceCandidate[];
  dtlsParameters: types.DtlsParameters;
}

/** '/voice' → ws(s)://<host>/voice; absolute ws-URLs unverändert. */
function resolveWsUrl(voiceUrl: string): string {
  if (voiceUrl.startsWith('ws://') || voiceUrl.startsWith('wss://')) return voiceUrl;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = voiceUrl.startsWith('/') ? voiceUrl : `/${voiceUrl}`;
  return `${proto}//${window.location.host}${path}`;
}
