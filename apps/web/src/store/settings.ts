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
  /** Gewähltes Mikrofon (MediaDeviceInfo.deviceId); null = Systemstandard. */
  micDeviceId: string | null;

  setMicThresholdDb: (db: number) => void;
  setSoundboardVolume: (volume: number) => void;
  setMicDeviceId: (deviceId: string | null) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      micThresholdDb: MIC_GATE_OFF_DB,
      soundboardVolume: 1,
      micDeviceId: null,
      setMicThresholdDb: (db) => set({ micThresholdDb: db }),
      setSoundboardVolume: (volume) => set({ soundboardVolume: volume }),
      setMicDeviceId: (deviceId) => set({ micDeviceId: deviceId }),
    }),
    { name: 'parley-settings' },
  ),
);

/**
 * Mikrofon-Stream mit dem gewählten Eingabegerät öffnen. `exact` erzwingt das
 * Gerät – ein weiches `ideal` reicht nicht: Läuft bereits eine Aufnahme
 * (Gerätewechsel während einer Verbindung), darf der Browser sonst bei der
 * schon offenen Standard-Quelle bleiben statt umzuschalten. Ist das
 * gespeicherte Gerät nicht (mehr) öffenbar (abgezogen/belegt), fällt der
 * zweite Versuch aufs Systemstandard-Gerät zurück.
 * Liegt hier statt in lib/voice.ts, damit AudioSettings sie nutzen kann, ohne
 * mediasoup-client in den Haupt-Bundle zu ziehen (Code-Splitting, Phase 15).
 */
export async function getMicStream(): Promise<MediaStream> {
  const { micDeviceId } = useSettingsStore.getState();
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (micDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { ...base, deviceId: { exact: micDeviceId } },
      });
    } catch {
      /* Gewähltes Gerät nicht verfügbar → Standardgerät versuchen. */
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}
