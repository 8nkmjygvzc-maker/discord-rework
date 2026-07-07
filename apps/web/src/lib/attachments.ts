/**
 * Anhangs-Orchestrierung des Web-Clients (Phase 8).
 *
 * Upload:   Datei → (für Bilder: Vorschaubild per Canvas) → beide Blobs mit
 *           frischen Zufallsschlüsseln verschlüsseln → als octet-stream
 *           hochladen. Schlüssel/Name/MIME-Typ landen NUR in den
 *           AttachmentMeta, die im E2EE-Nachrichtentext mitreisen.
 * Download: Ciphertext-Blob holen, im Client entschlüsseln, als Object-URL
 *           cachen (Vorschau) bzw. als Datei speichern.
 */
import {
  AttachmentInfo,
  AttachmentMeta,
  cryptoReady,
  decryptFileBytes,
  encryptFileBytes,
  MAX_ATTACHMENT_PLAINTEXT_BYTES,
} from '@parley/shared';
import { useAuthStore } from '../store/auth';

/** Längste Kante des Vorschaubilds – klein genug für schnelles Laden. */
export const THUMBNAIL_MAX_PX = 384;
/** Bewusst unter dem Server-Limit (10 Blobs/Nachricht, Bilder zählen doppelt). */
export const MAX_FILES_PER_MESSAGE = 4;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Verschlüsselt und lädt eine Datei (plus ggf. Vorschaubild) in den Kanal
 * hoch; liefert die Metadaten für den E2EE-Nachrichtentext.
 */
export async function uploadAttachment(channelId: string, file: File): Promise<AttachmentMeta> {
  if (file.size > MAX_ATTACHMENT_PLAINTEXT_BYTES) {
    throw new Error(`„${file.name}“ ist größer als 10 MiB`);
  }
  await cryptoReady();
  const { authUpload } = useAuthStore.getState();

  const plain = new Uint8Array(await file.arrayBuffer());
  const encrypted = encryptFileBytes(plain);
  const uploaded = await authUpload<AttachmentInfo>(
    `/api/channels/${channelId}/attachments`,
    encrypted.ciphertext,
  );
  const meta: AttachmentMeta = {
    id: uploaded.id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    key: encrypted.key,
    nonce: encrypted.nonce,
  };

  // Vorschaubild nur für Bilder; Fehlschlag (z. B. defekte Datei) ist kein
  // Abbruchgrund – dann gibt es eben nur den Datei-Chip ohne Vorschau.
  const thumbnail = await makeThumbnail(file).catch(() => null);
  if (thumbnail) {
    const encryptedThumb = encryptFileBytes(thumbnail.bytes);
    const uploadedThumb = await authUpload<AttachmentInfo>(
      `/api/channels/${channelId}/attachments`,
      encryptedThumb.ciphertext,
    );
    meta.thumbnail = {
      id: uploadedThumb.id,
      key: encryptedThumb.key,
      nonce: encryptedThumb.nonce,
      width: thumbnail.width,
      height: thumbnail.height,
    };
  }
  return meta;
}

/** Alle Blob-IDs einer Nachricht (Original + Vorschaubilder) fürs Verknüpfen. */
export function collectAttachmentIds(metas: AttachmentMeta[]): string[] {
  return metas.flatMap((m) => (m.thumbnail ? [m.id, m.thumbnail.id] : [m.id]));
}

// --- Download & Cache -----------------------------------------------------------

/** Entschlüsselte Blobs als Object-URLs, damit nichts doppelt geladen wird. */
const objectUrlCache = new Map<string, Promise<string>>();

export function getDecryptedObjectUrl(
  ref: { id: string; key: string; nonce: string },
  mimeType: string,
): Promise<string> {
  let pending = objectUrlCache.get(ref.id);
  if (!pending) {
    pending = (async () => {
      await cryptoReady();
      const ciphertext = await useAuthStore.getState().authDownload(`/api/attachments/${ref.id}`);
      const plain = decryptFileBytes(ref.key, ref.nonce, ciphertext);
      return URL.createObjectURL(new Blob([plain as BlobPart], { type: mimeType }));
    })();
    objectUrlCache.set(ref.id, pending);
    // Fehlgeschlagene Downloads nicht cachen – nächster Versuch soll neu laden.
    pending.catch(() => objectUrlCache.delete(ref.id));
  }
  return pending;
}

/** Lädt das Original herunter, entschlüsselt es und stößt den Browser-Download an. */
export async function saveAttachmentToDisk(meta: AttachmentMeta): Promise<void> {
  const url = await getDecryptedObjectUrl(meta, meta.mimeType);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = meta.name;
  anchor.click();
}

/** Bei Logout: entschlüsselte Blobs aus dem Speicher werfen. */
export function resetAttachmentCache(): void {
  for (const pending of objectUrlCache.values()) {
    void pending.then((url) => URL.revokeObjectURL(url)).catch(() => undefined);
  }
  objectUrlCache.clear();
}

// --- Vorschaubild ----------------------------------------------------------------

interface Thumbnail {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Skaliert Bilder clientseitig herunter (der Server kann aus Ciphertext keine Thumbnails rechnen). */
async function makeThumbnail(file: File): Promise<Thumbnail | null> {
  if (!file.type.startsWith('image/')) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMBNAIL_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.8),
    );
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}
