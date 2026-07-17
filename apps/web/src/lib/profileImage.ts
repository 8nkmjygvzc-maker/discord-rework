/**
 * Profil-/Server-Bild-Upload (Phase 15). Bilder werden clientseitig auf ein
 * Quadrat von 256 px zugeschnitten und herunterskaliert (Mitte-Crop) – klein
 * genug für schnelles Laden, groß genug für alle Anzeigegrößen der UI.
 *
 * Bewusst UNverschlüsselt (anders als Anhänge): Avatare/Icons sind – wie
 * Nutzer- und Servernamen – öffentliche Metadaten und müssen per <img>
 * ohne Auth-Header ladbar sein.
 */
import type { AuthUser, ServerSummary } from '@parley/shared';
import { useAuthStore } from '../store/auth';

const PROFILE_IMAGE_PX = 256;
/** Zielmaß des Profil-Banners (Querformat wie bei Discord). */
const BANNER_WIDTH_PX = 680;
const BANNER_HEIGHT_PX = 240;
/** Seitenverhältnis des Banners – für den Zuschneide-Dialog. */
export const BANNER_ASPECT = BANNER_WIDTH_PX / BANNER_HEIGHT_PX;

/** Vom Nutzer gewählter Bildausschnitt in Pixeln des Originalbilds. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Datei → quadratisches 256-px-PNG (Mitte-Crop). */
export function resizeProfileImage(file: File): Promise<Uint8Array> {
  return resizeCoverImage(file, PROFILE_IMAGE_PX, PROFILE_IMAGE_PX);
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Bitte eine Bilddatei auswählen');
  }
  return createImageBitmap(file).catch(() => {
    throw new Error('Das Bild konnte nicht gelesen werden');
  });
}

/** Ausschnitt `crop` aus dem Bitmap auf das Zielmaß skalieren und als PNG kodieren. */
async function drawCropToPng(
  bitmap: ImageBitmap,
  crop: CropRect,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden');
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Datei → PNG im Zielformat (Cover-Crop aus der Bildmitte). */
async function resizeCoverImage(file: File, width: number, height: number): Promise<Uint8Array> {
  const bitmap = await loadBitmap(file);
  try {
    // Größtmöglicher Ausschnitt im Ziel-Seitenverhältnis, mittig aus dem Bild.
    const scale = Math.min(bitmap.width / width, bitmap.height / height);
    const cropW = width * scale;
    const cropH = height * scale;
    return await drawCropToPng(
      bitmap,
      {
        x: (bitmap.width - cropW) / 2,
        y: (bitmap.height - cropH) / 2,
        width: cropW,
        height: cropH,
      },
      width,
      height,
    );
  } finally {
    bitmap.close();
  }
}

/** Datei → PNG im Zielformat aus einem vom Nutzer gewählten Ausschnitt. */
async function resizeCroppedImage(
  file: File,
  crop: CropRect,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const bitmap = await loadBitmap(file);
  try {
    // Ausschnitt sicherheitshalber auf die Bildgrenzen begrenzen (Rundungsreste).
    const x = Math.max(0, Math.min(crop.x, bitmap.width - 1));
    const y = Math.max(0, Math.min(crop.y, bitmap.height - 1));
    const w = Math.max(1, Math.min(crop.width, bitmap.width - x));
    const h = Math.max(1, Math.min(crop.height, bitmap.height - y));
    return await drawCropToPng(bitmap, { x, y, width: w, height: h }, width, height);
  } finally {
    bitmap.close();
  }
}

/** Profilbild hochladen; aktualisiert den Auth-Store mit der neuen avatarUrl. */
export async function uploadAvatar(file: File): Promise<void> {
  const bytes = await resizeProfileImage(file);
  const user = await useAuthStore.getState().authUpload<AuthUser>('/api/users/me/avatar', bytes);
  useAuthStore.setState({ user });
}

/**
 * Profil-Banner hochladen; aktualisiert den Auth-Store mit der neuen bannerUrl.
 * Mit `crop` wird der vom Nutzer gewählte Ausschnitt verwendet, sonst der Mitte-Crop.
 */
export async function uploadBanner(file: File, crop?: CropRect): Promise<void> {
  const bytes = crop
    ? await resizeCroppedImage(file, crop, BANNER_WIDTH_PX, BANNER_HEIGHT_PX)
    : await resizeCoverImage(file, BANNER_WIDTH_PX, BANNER_HEIGHT_PX);
  const user = await useAuthStore.getState().authUpload<AuthUser>('/api/users/me/banner', bytes);
  useAuthStore.setState({ user });
}

/** Server-Icon hochladen (ManageServer); das SERVER_UPDATE-Event zieht die UI nach. */
export async function uploadServerIcon(serverId: string, file: File): Promise<ServerSummary> {
  const bytes = await resizeProfileImage(file);
  return useAuthStore.getState().authUpload<ServerSummary>(`/api/servers/${serverId}/icon`, bytes);
}
