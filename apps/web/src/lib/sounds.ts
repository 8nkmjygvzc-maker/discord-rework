/**
 * UI-Sounds (Phase 15, überarbeitet in der Verbesserungs-Runde): Statt
 * Audiodateien werden kurze Zwei-Ton-Chimes per WebAudio synthetisiert –
 * ein warmes „Da-Ding“ im Stil bekannter Voice-Apps (die vorherigen
 * .ogg-Assets klangen wie AirPods-Verbindungstöne, Nutzerwunsch: weg damit).
 *
 * `connect`/`disconnect` begleiten den EIGENEN Beitritt/Abschied,
 * `userJoin`/`userLeave` (leiser, kürzer) melden ANDERE Teilnehmer im
 * eigenen Sprachkanal.
 */

export type SoundName = 'connect' | 'disconnect' | 'userJoin' | 'userLeave';

interface Note {
  /** Grundfrequenz in Hz. */
  freq: number;
  /** Startzeit relativ zum Abspielbeginn (Sekunden). */
  at: number;
  /** Klingdauer (Sekunden). */
  dur: number;
}

/** Aufsteigend = Ankommen, absteigend = Gehen; eigene Events etwas präsenter. */
const CHIMES: Record<SoundName, { notes: Note[]; volume: number }> = {
  connect: {
    notes: [
      { freq: 392, at: 0, dur: 0.18 }, // G4
      { freq: 587.33, at: 0.1, dur: 0.28 }, // D5
    ],
    volume: 0.3,
  },
  disconnect: {
    notes: [
      { freq: 587.33, at: 0, dur: 0.18 },
      { freq: 392, at: 0.1, dur: 0.28 },
    ],
    volume: 0.3,
  },
  userJoin: {
    notes: [
      { freq: 523.25, at: 0, dur: 0.12 }, // C5
      { freq: 659.25, at: 0.08, dur: 0.2 }, // E5
    ],
    volume: 0.18,
  },
  userLeave: {
    notes: [
      { freq: 659.25, at: 0, dur: 0.12 },
      { freq: 523.25, at: 0.08, dur: 0.2 },
    ],
    volume: 0.18,
  },
};

/** Ein gemeinsamer, lazy erzeugter AudioContext für alle UI-Sounds. */
let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null; // kein WebAudio (sehr alte Browser) → Sounds still auslassen
    }
  }
  // Autoplay-Policy: ohne Nutzer-Geste startet der Context suspendiert. Die
  // relevanten Sounds folgen aber ohnehin auf Klicks (Voice-Beitritt) – ein
  // best-effort resume() genügt; schlägt er fehl, bleibt es eben still.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/**
 * Spielt einen kurzen UI-Sound ab. Fehler (Autoplay-Policy, fehlendes
 * WebAudio) werden bewusst verschluckt – Sounds sind nice-to-have und dürfen
 * nie einen Ablauf blockieren.
 */
export function playSound(name: SoundName): void {
  const ac = audioContext();
  if (!ac || ac.state !== 'running') return;
  const { notes, volume } = CHIMES[name];
  const t0 = ac.currentTime + 0.02;
  for (const note of notes) {
    const start = t0 + note.at;
    const end = start + note.dur;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    // Dreieck klingt weicher als Rechteck, aber voller als ein reiner Sinus.
    osc.type = 'triangle';
    osc.frequency.value = note.freq;
    // Kurzer Attack gegen Knackser, danach exponentielles Ausklingen.
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.05);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }
}

/**
 * Klingelton für eingehende private Anrufe: zwei kurze Doppeltöne pro
 * Wiederholung, synthetisiert über WebAudio (kein Asset nötig). Liefert eine
 * Stop-Funktion. Greift die Autoplay-Policy (noch keine Interaktion), bleibt
 * es still – das Anruf-Overlay ist dann der sichtbare Hinweis.
 */
export function startRingtone(): () => void {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return () => undefined;
  const ctx = new Ctor();
  void ctx.resume().catch(() => undefined);

  const beep = (at: number, freq: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    // Weiche Rampen gegen Knackser.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.18, at + 0.02);
    gain.gain.setValueAtTime(0.18, at + 0.16);
    gain.gain.linearRampToValueAtTime(0, at + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.22);
  };

  const ringOnce = () => {
    const t = ctx.currentTime + 0.05;
    beep(t, 880);
    beep(t + 0.28, 660);
  };
  ringOnce();
  const interval = window.setInterval(ringOnce, 2_000);

  return () => {
    window.clearInterval(interval);
    void ctx.close().catch(() => undefined);
  };
}
