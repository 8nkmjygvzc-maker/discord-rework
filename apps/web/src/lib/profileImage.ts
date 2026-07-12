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

/** Datei → quadratisches 256-px-PNG (Mitte-Crop). */
export async function resizeProfileImage(file: File): Promise<Uint8Array> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Bitte eine Bilddatei auswählen');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Das Bild konnte nicht gelesen werden');
  });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = PROFILE_IMAGE_PX;
    canvas.height = PROFILE_IMAGE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden');
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, PROFILE_IMAGE_PX, PROFILE_IMAGE_PX);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Bild konnte nicht verarbeitet werden');
    return new Uint8Array(await blob.arrayBuffer());
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

/** Server-Icon hochladen (ManageServer); das SERVER_UPDATE-Event zieht die UI nach. */
export async function uploadServerIcon(serverId: string, file: File): Promise<ServerSummary> {
  const bytes = await resizeProfileImage(file);
  return useAuthStore.getState().authUpload<ServerSummary>(`/api/servers/${serverId}/icon`, bytes);
}
