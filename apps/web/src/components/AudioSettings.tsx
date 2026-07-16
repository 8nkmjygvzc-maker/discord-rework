import { useCallback, useEffect, useState } from 'react';
import { MIC_GATE_OFF_DB, getMicStream, useSettingsStore } from '../store/settings';
import { useVoiceStore } from '../store/voice';

/**
 * „Sprache & Audio“-Einstellungen (Profilseite, Feinschliff): Mikrofon-Auswahl
 * (Eingabegerät), Mikrofon-Empfindlichkeit (Noise-Gate-Schwelle) mit Live-
 * Mikrofontest sowie die lokale Soundboard-Lautstärke. Alle Werte liegen im
 * Settings-Store (localStorage) und wirken sofort – auch während einer
 * laufenden Sprachverbindung.
 */

/** dBFS (−100…0) → Prozentposition auf Pegelanzeige/Slider-Skala. */
function dbToPercent(db: number): number {
  return Math.min(100, Math.max(0, ((db - MIC_GATE_OFF_DB) / -MIC_GATE_OFF_DB) * 100));
}

export default function AudioSettings() {
  const micThresholdDb = useSettingsStore((s) => s.micThresholdDb);
  const setMicThresholdDb = useSettingsStore((s) => s.setMicThresholdDb);
  const soundboardVolume = useSettingsStore((s) => s.soundboardVolume);
  const setSoundboardVolume = useSettingsStore((s) => s.setSoundboardVolume);
  const micDeviceId = useSettingsStore((s) => s.micDeviceId);
  const setMicDeviceId = useSettingsStore((s) => s.setMicDeviceId);

  const [testing, setTesting] = useState(false);
  const [levelDb, setLevelDb] = useState<number>(MIC_GATE_OFF_DB);
  const [micError, setMicError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  /** true = Browser gibt die Gerätenamen erst nach einer Mikrofon-Freigabe her. */
  const [labelsLocked, setLabelsLocked] = useState(false);

  const loadDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      // Ohne erteilte Berechtigung liefert der Browser leere deviceIds/Labels –
      // solche Platzhalter-Einträge sind nicht auswählbar und fliegen raus.
      const inputs = all.filter((d) => d.kind === 'audioinput' && d.deviceId !== '');
      setDevices(inputs);
      setLabelsLocked(inputs.length === 0 || inputs.every((d) => !d.label));
    } catch {
      /* Geräteliste nicht verfügbar → Auswahl bleibt bei „Standard“. */
    }
  }, []);

  // Geräteliste laden und bei An-/Abstecken (devicechange) aktualisieren.
  useEffect(() => {
    void loadDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = (): void => void loadDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [loadDevices]);

  // Mikrofontest: Pegel per WebAudio messen (gleiche RMS→dBFS-Rechnung wie das
  // Noise-Gate in lib/voice.ts, damit die Anzeige zur Übertragung passt).
  // Hängt vom gewählten Gerät ab – ein Wechsel startet den Test darauf neu.
  useEffect(() => {
    if (!testing) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    void (async () => {
      try {
        stream = await getMicStream();
        // Die Freigabe schaltet auch die Gerätenamen frei → Liste auffrischen.
        void loadDevices();
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          const rms = Math.sqrt(sum / buf.length);
          setLevelDb(rms > 0 ? 20 * Math.log10(rms) : MIC_GATE_OFF_DB);
        }, 50);
      } catch {
        if (!cancelled) {
          setMicError('Mikrofon nicht verfügbar oder Zugriff verweigert.');
          setTesting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx) void ctx.close().catch(() => undefined);
      setLevelDb(MIC_GATE_OFF_DB);
    };
  }, [testing, micDeviceId, loadDevices]);

  /** Kurze getUserMedia-Freigabe, nur um die Gerätenamen freizuschalten. */
  async function unlockDeviceLabels(): Promise<void> {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await loadDevices();
    } catch {
      setMicError('Mikrofon nicht verfügbar oder Zugriff verweigert.');
    }
  }

  const gateOff = micThresholdDb <= MIC_GATE_OFF_DB;
  // Würde bei diesem Pegel übertragen werden? (steuert die Farbe der Anzeige)
  const wouldTransmit = gateOff || levelDb >= micThresholdDb;

  return (
    <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold text-zinc-300">Sprache &amp; Audio</h2>

      {/* Mikrofon-Auswahl (Eingabegerät) */}
      <label className="mt-3 block text-xs text-zinc-400">
        <span>Eingabegerät</span>
        <select
          value={micDeviceId ?? ''}
          onChange={(e) => {
            setMicDeviceId(e.target.value || null);
            // Läuft gerade eine Sprachverbindung, sofort umschalten.
            void useVoiceStore.getState().applyMicDevice();
          }}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
          data-testid="mic-device"
        >
          <option value="">Standard (Systemeinstellung)</option>
          {micDeviceId !== null && !devices.some((d) => d.deviceId === micDeviceId) && (
            <option value={micDeviceId}>Gespeichertes Gerät (nicht gefunden)</option>
          )}
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Mikrofon ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      {labelsLocked ? (
        <p className="mt-1 text-xs text-zinc-500">
          Der Browser zeigt die Gerätenamen erst nach einer Mikrofon-Freigabe.{' '}
          <button
            type="button"
            onClick={() => void unlockDeviceLabels()}
            className="text-indigo-400 hover:text-indigo-300 hover:underline"
          >
            Jetzt freigeben
          </button>
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">
          Wirkt sofort – auch während einer laufenden Sprachverbindung. Ist das Gerät nicht
          angeschlossen, wird das Standardgerät benutzt.
        </p>
      )}

      {/* Mikrofon-Empfindlichkeit (Noise-Gate-Schwelle) */}
      <label className="mt-3 block text-xs text-zinc-400">
        <span className="flex items-center justify-between">
          <span>Mikrofon-Empfindlichkeit</span>
          <span className="tabular-nums text-zinc-300">
            {gateOff ? 'Aus (immer übertragen)' : `${micThresholdDb} dB`}
          </span>
        </span>
        <input
          type="range"
          min={MIC_GATE_OFF_DB}
          max={0}
          step={1}
          value={micThresholdDb}
          onChange={(e) => setMicThresholdDb(Number(e.target.value))}
          className="mt-1 w-full"
          data-testid="mic-threshold"
        />
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        Unterhalb der Schwelle überträgt dein Mikrofon nichts (Noise-Gate). Ganz links: immer
        übertragen. Wirkt sofort, auch während einer Sprachverbindung.
      </p>

      {/* Live-Pegelanzeige mit Schwellen-Markierung */}
      <div className="mt-3">
        <div className="relative h-2 overflow-hidden rounded bg-zinc-800">
          <div
            className={`h-full transition-[width] duration-75 ${
              testing ? (wouldTransmit ? 'bg-emerald-500' : 'bg-zinc-500') : ''
            }`}
            style={{ width: `${testing ? dbToPercent(levelDb) : 0}%` }}
          />
          {!gateOff && (
            <div
              className="absolute inset-y-0 w-0.5 bg-yellow-400"
              style={{ left: `${dbToPercent(micThresholdDb)}%` }}
              title="Empfindlichkeits-Schwelle"
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setMicError(null);
              setTesting((t) => !t);
            }}
            className={`rounded px-3 py-1 text-xs font-medium ${
              testing
                ? 'bg-red-950/60 text-red-300 hover:bg-red-950'
                : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
            }`}
          >
            {testing ? 'Test beenden' : '🎤 Mikrofon testen'}
          </button>
          {testing && (
            <span className={`text-xs ${wouldTransmit ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {wouldTransmit ? 'Würde übertragen' : 'Stumm (unter Schwelle)'}
            </span>
          )}
        </div>
        {micError && <p className="mt-2 text-xs text-red-400">{micError}</p>}
      </div>

      {/* Lokale Soundboard-Lautstärke (wirkt live auf spielende Sounds) */}
      <label className="mt-4 block border-t border-zinc-800 pt-3 text-xs text-zinc-400">
        <span className="flex items-center justify-between">
          <span>Soundboard-Lautstärke</span>
          <span className="tabular-nums text-zinc-300">{Math.round(soundboardVolume * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(soundboardVolume * 100)}
          onChange={(e) => setSoundboardVolume(Number(e.target.value) / 100)}
          className="mt-1 w-full"
          data-testid="soundboard-volume"
        />
      </label>
      <p className="mt-1 text-xs text-zinc-500">
        Nur für dich – wirkt sofort, auch auf gerade spielende Sounds.
      </p>
    </div>
  );
}
