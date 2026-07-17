/**
 * Soundboard-Wiedergabe (Client-Seite). Audio-Blobs werden pro Sound-ID als
 * Object-URL gecacht (gleiches Prinzip wie die Anhänge in lib/attachments.ts).
 * Eine Dauer-Grenze gibt es seit der Quality-of-Life-Runde nicht mehr –
 * nur die Dateigröße ist gedeckelt (serverseitig geprüft).
 */
import { SoundboardSoundInfo } from '@parley/shared';
import { useAuthStore } from '../store/auth';
import { useSettingsStore } from '../store/settings';

const soundUrlCache = new Map<string, Promise<string>>();

/** Gerade spielende Sounds – für die Live-Anpassung der lokalen Lautstärke. */
const playingAudios = new Set<{ el: HTMLAudioElement; baseVolume: number }>();

/** Effektive Lautstärke = Sound-Lautstärke × lokaler Regler (Einstellungen). */
function applyVolume(entry: { el: HTMLAudioElement; baseVolume: number }): void {
  const local = useSettingsStore.getState().soundboardVolume;
  entry.el.volume = Math.min(1, Math.max(0, entry.baseVolume * local));
}

// Änderungen am Lautstärke-Regler wirken sofort auf alles, was gerade spielt.
useSettingsStore.subscribe((state, prev) => {
  if (state.soundboardVolume === prev.soundboardVolume) return;
  for (const entry of playingAudios) applyVolume(entry);
});

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

/** Spielt einen Soundboard-Sound lokal ab (Lautstärke geklemmt). */
export async function playSoundboardSound(sound: SoundboardSoundInfo): Promise<void> {
  const url = await getSoundObjectUrl(sound);
  const audio = new Audio(url);
  const entry = { el: audio, baseVolume: Math.min(1, Math.max(0, sound.volume)) };
  applyVolume(entry);
  playingAudios.add(entry);
  audio.addEventListener('ended', () => playingAudios.delete(entry), { once: true });
  try {
    await audio.play();
  } catch {
    // Autoplay-Policy o. Ä. – Sounds sind nice-to-have und blockieren nichts.
    playingAudios.delete(entry);
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
 * (eine Dauer-Grenze gibt es nicht mehr). Wirft mit verständlicher Meldung,
 * sonst kommt die Dauer zurück.
 */
export async function probeUploadableAudio(file: File): Promise<number> {
  try {
    // OfflineAudioContext dekodiert ohne hörbare Ausgabe und ohne Nutzer-Geste.
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return decoded.duration;
  } catch {
    throw new Error(`„${file.name}“ ist keine abspielbare Audiodatei`);
  }
}
