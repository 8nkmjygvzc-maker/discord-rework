import { Device, types } from 'mediasoup-client';
import type { VoiceProducerInfo, VoiceServerMessage } from '@parley/shared';

/**
 * Browser-seitige Voice-Anbindung (Phase 10). Kapselt die mediasoup-client-
 * Logik: WebSocket zum SFU, Device laden, Send-/Recv-Transporte, eigenen
 * Mikrofon-Producer und das Konsumieren der anderen Teilnehmer. Der Store
 * (store/voice.ts) orchestriert Beitritt/Verlassen/Mute; diese Klasse macht
 * ausschließlich die Medien.
 *
 * Ohne funktionierendes Mikrofon (Berechtigung verweigert / kein Gerät) wird
 * NUR zugehört (kein Producer) – man ist trotzdem im Kanal, nur stumm.
 */

interface VoiceCallbacks {
  /** Verbindung unerwartet geschlossen (z. B. SFU weg) → Store räumt auf. */
  onClosed: () => void;
}

let ridSeq = 1;

export class VoiceClient {
  private ws: WebSocket | null = null;
  private device: Device | null = null;
  private sendTransport: types.Transport | null = null;
  private recvTransport: types.Transport | null = null;
  private micProducer: types.Producer | null = null;
  private micTrack: MediaStreamTrack | null = null;
  private readonly consumers = new Map<string, types.Consumer>();
  /** Ein verstecktes <audio>-Element pro Consumer (Wiedergabe der Ströme). */
  private readonly audioEls = new Map<string, HTMLAudioElement>();
  private readonly pending = new Map<
    number,
    { resolve: (d: unknown) => void; reject: (e: Error) => void }
  >();
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
    for (const p of producers) await this.consume(p.producerId);
  }

  /** Mikrofon stumm/laut schalten (pausiert den Producer und meldet es dem SFU). */
  async setMicPaused(paused: boolean): Promise<void> {
    if (!this.micProducer) return;
    if (paused) this.micProducer.pause();
    else this.micProducer.resume();
    try {
      await this.rpc(paused ? 'pauseProducer' : 'resumeProducer', {
        producerId: this.micProducer.id,
      });
    } catch {
      /* Best-effort – der lokale Pausenzustand zählt für die Übertragung. */
    }
  }

  /** Deafen: alle eingehenden Ströme stummschalten (lokal). */
  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    for (const el of this.audioEls.values()) el.muted = deafened;
  }

  disconnect(): void {
    this.closed = true;
    this.micTrack?.stop();
    this.sendTransport?.close();
    this.recvTransport?.close();
    for (const el of this.audioEls.values()) {
      el.pause();
      el.srcObject = null;
      el.remove();
    }
    this.audioEls.clear();
    this.consumers.clear();
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
    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      this.rpc('produce', { transportId: transport.id, kind, rtpParameters })
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
        this.micProducer = await this.sendTransport.produce({ track: this.micTrack });
      }
    } catch {
      // Kein Mikrofon/keine Berechtigung → Zuhörer-Modus. Nicht fatal.
      this.micProducer = null;
      this.micTrack = null;
    }
  }

  private async consume(producerId: string): Promise<void> {
    if (!this.recvTransport || !this.device) return;
    try {
      const data = (await this.rpc('consume', {
        producerId,
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
      this.playTrack(consumer.id, consumer.track);
      await this.rpc('resumeConsumer', { consumerId: consumer.id });
    } catch {
      /* Producer evtl. schon wieder weg – ignorieren. */
    }
  }

  private playTrack(consumerId: string, track: MediaStreamTrack): void {
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

  private closeConsumerByProducer(producerId: string): void {
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
    }
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
        void this.consume(msg.producer.producerId);
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
