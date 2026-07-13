// UI-Sounds (Phase 15). Vite bündelt die .ogg-Dateien als Assets und liefert
// gehashte URLs – die Typdeklarationen dafür kommen aus "vite/client".
import connectUrl from '../assets/sounds/connect.ogg';
import disconnectUrl from '../assets/sounds/disconnect.ogg';

const SOUNDS = {
  connect: connectUrl,
  disconnect: disconnectUrl,
} as const;

export type SoundName = keyof typeof SOUNDS;

/**
 * Spielt einen kurzen UI-Sound ab. Fehler (z. B. Autoplay-Policy, wenn noch
 * keine Nutzer-Interaktion stattfand) werden bewusst verschluckt – Sounds
 * sind nice-to-have und dürfen nie einen Ablauf blockieren.
 */
export function playSound(name: SoundName, volume = 0.5): void {
  const audio = new Audio(SOUNDS[name]);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
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
