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
