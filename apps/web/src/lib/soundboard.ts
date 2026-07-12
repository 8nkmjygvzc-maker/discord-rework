/**
 * Soundboard-Wiedergabe (Client-Seite). Audio-Blobs werden pro Sound-ID als
 * Object-URL gecacht (gleiches Prinzip wie die Anhänge in lib/attachments.ts).
 * Die Wiedergabe ist hart auf MAX_SOUNDBOARD_PLAY_SECONDS gedeckelt – der
 * Server prüft nur die Dateigröße, nicht die Dauer; ohne den Deckel könnte
 * eine manipulierte (überlange Niedrig-Bitraten-)Datei den Kanal beschallen.
 */
import {
  MAX_SOUNDBOARD_PLAY_SECONDS,
  MAX_SOUNDBOARD_UPLOAD_SECONDS,
  SoundboardSoundInfo,
} from '@parley/shared';
import { useAuthStore } from '../store/auth';

const soundUrlCache = new Map<string, Promise<string>>();

function getSoundObjectUrl(sound: Pick<SoundboardSoundInfo, 'id' | 'mimeType'>): Promise<string> {
  let pending = soundUrlCache.get(sound.id);
  if (!pending) {
    pending = (async () => {
      const bytes = await useAuthStore.getState().authDownload(`/api/soundboard/${sound.id}/audio`);
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: sound.mimeType }));
    })();
    soundUrlCache.set(sound.id, pending);
    // Fehlgeschlagene Downloads nicht cachen – nächster Versuch soll neu laden.
    pending.catch(() => soundUrlCache.delete(sound.id));
  }
  return pending;
}

/** Spielt einen Soundboard-Sound lokal ab (Lautstärke geklemmt, Dauer gedeckelt). */
export async function playSoundboardSound(sound: SoundboardSoundInfo): Promise<void> {
  const url = await getSoundObjectUrl(sound);
  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, sound.volume));
  const stopper = setTimeout(() => audio.pause(), MAX_SOUNDBOARD_PLAY_SECONDS * 1000);
  audio.addEventListener('ended', () => clearTimeout(stopper), { once: true });
  try {
    await audio.play();
  } catch {
    // Autoplay-Policy o. Ä. – Sounds sind nice-to-have und blockieren nichts.
    clearTimeout(stopper);
  }
}

/** Beim Logout: Object-URLs freigeben und Cache leeren. */
export function resetSoundboardCache(): void {
  for (const pending of soundUrlCache.values()) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  soundUrlCache.clear();
}

/**
 * Validiert eine Datei VOR dem Upload: Der Browser muss sie dekodieren können
 * und die Dauer darf MAX_SOUNDBOARD_UPLOAD_SECONDS nicht überschreiten.
 * Wirft mit verständlicher Meldung, sonst kommt die Dauer zurück.
 */
export async function probeUploadableAudio(file: File): Promise<number> {
  let duration: number;
  try {
    // OfflineAudioContext dekodiert ohne hörbare Ausgabe und ohne Nutzer-Geste.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    duration = decoded.duration;
  } catch {
    throw new Error(`„${file.name}“ ist keine abspielbare Audiodatei`);
  }
  if (duration > MAX_SOUNDBOARD_UPLOAD_SECONDS) {
    throw new Error(
      `„${file.name}“ ist ${duration.toFixed(1)} s lang – erlaubt sind max. ${MAX_SOUNDBOARD_UPLOAD_SECONDS} s`,
    );
  }
  return duration;
}
