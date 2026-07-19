/**
 * Sticker-Bilder (Client-Seite). Die Blobs werden pro Sticker-ID als
 * Object-URL gecacht (gleiches Prinzip wie Soundboard-Sounds und Anhänge in
 * lib/attachments.ts) – jedes Bild wird pro Sitzung höchstens einmal geladen,
 * egal wie oft der Sticker im Verlauf oder Picker auftaucht.
 */
import { useAuthStore } from '../store/auth';

const stickerUrlCache = new Map<string, Promise<string>>();

/**
 * Object-URL des Sticker-Bilds (lädt bei Bedarf). `mimeType` stammt aus der
 * E2EE-Sticker-Referenz bzw. der Bibliothek; fehlt er, bekommt der Blob
 * keinen Typ – Browser erkennen Bildformate dann an den Magic Bytes.
 */
export function getStickerImageUrl(stickerId: string, mimeType?: string): Promise<string> {
  let pending = stickerUrlCache.get(stickerId);
  if (!pending) {
    pending = (async () => {
      const bytes = await useAuthStore.getState().authDownload(`/api/stickers/${stickerId}/image`);
      return URL.createObjectURL(
        new Blob([bytes as BlobPart], mimeType ? { type: mimeType } : undefined),
      );
    })();
    stickerUrlCache.set(stickerId, pending);
    // Fehlgeschlagene Downloads nicht cachen – nächster Versuch soll neu laden.
    pending.catch(() => stickerUrlCache.delete(stickerId));
  }
  return pending;
}

/** Beim Logout: Object-URLs freigeben und Cache leeren. */
export function resetStickerCache(): void {
  for (const pending of stickerUrlCache.values()) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  stickerUrlCache.clear();
}

/**
 * Validiert eine Datei VOR dem Upload: Der Browser muss sie als Bild
 * dekodieren können (gleiches Prinzip wie probeUploadableAudio beim
 * Soundboard). Wirft mit verständlicher Meldung.
 */
export async function probeUploadableImage(file: File): Promise<void> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
  } catch {
    throw new Error(`„${file.name}“ ist kein lesbares Bild`);
  }
}
