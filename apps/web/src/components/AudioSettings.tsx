import { useEffect, useState } from 'react';
import { MIC_GATE_OFF_DB, useSettingsStore } from '../store/settings';

/**
 * „Sprache & Audio“-Einstellungen (Profilseite, Feinschliff): Mikrofon-
 * Empfindlichkeit (Noise-Gate-Schwelle) mit Live-Mikrofontest sowie die lokale
 * Soundboard-Lautstärke. Beide Werte liegen im Settings-Store (localStorage)
 * und wirken sofort – auch während einer laufenden Sprachverbindung.
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

  const [testing, setTesting] = useState(false);
  const [levelDb, setLevelDb] = useState<number>(MIC_GATE_OFF_DB);
  const [micError, setMicError] = useState<string | null>(null);

  // Mikrofontest: Pegel per WebAudio messen (gleiche RMS→dBFS-Rechnung wie das
  // Noise-Gate in lib/voice.ts, damit die Anzeige zur Übertragung passt).
  useEffect(() => {
    if (!testing) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
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
  }, [testing]);

  const gateOff = micThresholdDb <= MIC_GATE_OFF_DB;
  // Würde bei diesem Pegel übertragen werden? (steuert die Farbe der Anzeige)
  const wouldTransmit = gateOff || levelDb >= micThresholdDb;

  return (
    <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold text-zinc-300">Sprache &amp; Audio</h2>

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
