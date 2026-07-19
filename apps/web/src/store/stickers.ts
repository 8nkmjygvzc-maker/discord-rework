import { create } from 'zustand';
import { MAX_STICKER_BYTES, StickerInfo, UpdateStickerRequest } from '@parley/shared';
import { useAuthStore } from './auth';
import { probeUploadableImage } from '../lib/stickers';

/**
 * Sticker-Zustand: die geladene Bibliothek (des ausgewählten Servers),
 * Upload/Verwaltung und die Reaktion auf das Gateway-Event STICKER_UPDATE
 * (Bibliothek neu laden). Das VERSCHICKEN eines Stickers läuft nicht hier,
 * sondern über den Messages-Store (sendSticker) – es ist eine normale
 * E2EE-Nachricht.
 */

interface StickersStoreState {
  /** Server, dessen Bibliothek gerade geladen ist (null = nichts geladen). */
  serverId: string | null;
  stickers: StickerInfo[];
  loading: boolean;
  error: string | null;

  load: (serverId: string) => Promise<void>;
  handleStickerUpdate: (serverId: string) => void;
  upload: (serverId: string, file: File, name: string) => Promise<void>;
  rename: (serverId: string, stickerId: string, name: string) => Promise<void>;
  remove: (serverId: string, stickerId: string) => Promise<void>;
  reset: () => void;
}

export const useStickersStore = create<StickersStoreState>()((set, get) => ({
  serverId: null,
  stickers: [],
  loading: false,
  error: null,

  load: async (serverId) => {
    set({ serverId, loading: true, error: null });
    try {
      const stickers = await useAuthStore
        .getState()
        .authFetch<StickerInfo[]>(`/api/servers/${serverId}/stickers`);
      // Antwort verwerfen, wenn inzwischen ein anderer Server geladen wird.
      if (get().serverId === serverId) set({ stickers, loading: false });
    } catch (err) {
      if (get().serverId === serverId) {
        set({ loading: false, error: err instanceof Error ? err.message : 'Laden fehlgeschlagen' });
      }
    }
  },

  handleStickerUpdate: (serverId) => {
    // Nur neu laden, wenn genau diese Bibliothek gerade im Speicher liegt.
    if (get().serverId === serverId) void get().load(serverId);
  },

  upload: async (serverId, file, name) => {
    if (file.size > MAX_STICKER_BYTES) {
      throw new Error(`„${file.name}“ ist größer als 1 MiB`);
    }
    const mimeType = file.type;
    if (!mimeType.startsWith('image/')) {
      throw new Error(`„${file.name}“ ist keine Bilddatei`);
    }
    // Dekodierbarkeit prüfen, BEVOR Bytes zum Server wandern.
    await probeUploadableImage(file);

    const params = new URLSearchParams({ name, mimeType });
    await useAuthStore
      .getState()
      .authUpload<StickerInfo>(
        `/api/servers/${serverId}/stickers?${params.toString()}`,
        new Uint8Array(await file.arrayBuffer()),
      );
    // Liste sofort nachziehen (das STICKER_UPDATE-Event macht dasselbe –
    // doppeltes Laden ist harmlos, aber so ist die UI auch ohne Event aktuell).
    await get().load(serverId);
  },

  rename: async (serverId, stickerId, name) => {
    const body: UpdateStickerRequest = { name };
    await useAuthStore
      .getState()
      .authFetch<StickerInfo>(`/api/servers/${serverId}/stickers/${stickerId}`, {
        method: 'PATCH',
        body,
      });
    await get().load(serverId);
  },

  remove: async (serverId, stickerId) => {
    await useAuthStore
      .getState()
      .authFetch<void>(`/api/servers/${serverId}/stickers/${stickerId}`, { method: 'DELETE' });
    await get().load(serverId);
  },

  reset: () => {
    set({ serverId: null, stickers: [], loading: false, error: null });
  },
}));
