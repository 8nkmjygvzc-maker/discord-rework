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
 * getUserMedia-Constraints fürs Mikrofon: Standard-Verarbeitung plus das
 * gewählte Eingabegerät. Bewusst `ideal` statt `exact`, damit der Browser auf
 * das Standardgerät zurückfällt, wenn das gespeicherte Gerät nicht mehr
 * existiert (z. B. Headset abgezogen) – statt komplett zu scheitern.
 * Liegt hier statt in lib/voice.ts, damit AudioSettings sie nutzen kann, ohne
 * mediasoup-client in den Haupt-Bundle zu ziehen (Code-Splitting, Phase 15).
 */
export function micAudioConstraints(): MediaTrackConstraints {
  const { micDeviceId } = useSettingsStore.getState();
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(micDeviceId ? { deviceId: { ideal: micDeviceId } } : {}),
  };
}
