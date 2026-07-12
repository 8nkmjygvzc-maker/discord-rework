import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Lokale Client-Einstellungen (Feinschliff). Bewusst im localStorage statt am
 * Account: Mikrofon-Empfindlichkeit und Wiedergabelautstärke sind Geräte-
 * Eigenschaften (anderes Headset = andere Werte) und nicht sensibel – anders
 * als die Tokens, die absichtlich NICHT im localStorage liegen (store/auth.ts).
 */

/** Untere Slider-Grenze; auf diesem Wert ist das Noise-Gate deaktiviert. */
export const MIC_GATE_OFF_DB = -100;

interface SettingsState {
  /**
   * Mikrofon-Empfindlichkeit als Schwelle in dBFS: Liegt der Eingangspegel
   * darunter, überträgt das Mikrofon nichts (Noise-Gate in lib/voice.ts).
   * MIC_GATE_OFF_DB = immer übertragen (Standard, wie ohne Gate).
   */
  micThresholdDb: number;
  /** Lokale Soundboard-Lautstärke 0–1 (multipliziert die Lautstärke des Sounds). */
  soundboardVolume: number;

  setMicThresholdDb: (db: number) => void;
  setSoundboardVolume: (volume: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      micThresholdDb: MIC_GATE_OFF_DB,
      soundboardVolume: 1,
      setMicThresholdDb: (db) => set({ micThresholdDb: db }),
      setSoundboardVolume: (volume) => set({ soundboardVolume: volume }),
    }),
    { name: 'parley-settings' },
  ),
);
