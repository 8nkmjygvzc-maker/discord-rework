import { useEffect, useRef, useState } from 'react';
import { MAX_STICKER_NAME_LENGTH, StickerInfo } from '@parley/shared';
import { useStickersStore } from '../store/stickers';
import { useAuthStore } from '../store/auth';
import StickerImage from './StickerImage';

interface StickerPickerProps {
  serverId: string;
  /** ManageStickers: Upload/Umbenennen; löschen darf auch der Uploader selbst. */
  canManage: boolean;
  onPick: (sticker: StickerInfo) => void;
  onClose: () => void;
}

/**
 * Sticker-Picker über der Eingabezeile (wie der @-Erwähnungs-Picker): Klick
 * auf einen Sticker verschickt ihn sofort als eigene Nachricht. Wer die
 * nötigen Rechte hat, kann hier auch hochladen, umbenennen und löschen –
 * die UI blendet nur aus, blockiert wird serverseitig (403).
 */
export default function StickerPicker({
  serverId,
  canManage,
  onPick,
  onClose,
}: StickerPickerProps) {
  const stickers = useStickersStore((s) => s.stickers);
  const loading = useStickersStore((s) => s.loading);
  const storeError = useStickersStore((s) => s.error);
  const me = useAuthStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Bibliothek beim Öffnen laden (STICKER_UPDATE hält sie danach aktuell).
  useEffect(() => {
    if (useStickersStore.getState().serverId !== serverId) {
      void useStickersStore.getState().load(serverId);
    }
  }, [serverId]);

  function chooseFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setLocalError(null);
    setPendingFile(file);
    // Dateiname (ohne Endung) als Namensvorschlag.
    setUploadName(file.name.replace(/\.[^.]+$/, '').slice(0, MAX_STICKER_NAME_LENGTH) || 'Sticker');
  }

  async function doUpload() {
    const name = uploadName.trim();
    if (!pendingFile || !name || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      await useStickersStore.getState().upload(serverId, pendingFile, name);
      setPendingFile(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Upload fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  function doRename(sticker: StickerInfo) {
    const name = window
      .prompt(`Neuer Name für „${sticker.name}“:`, sticker.name)
      ?.trim()
      .slice(0, MAX_STICKER_NAME_LENGTH);
    if (!name || name === sticker.name) return;
    useStickersStore
      .getState()
      .rename(serverId, sticker.id, name)
      .catch((err: unknown) => {
        setLocalError(err instanceof Error ? err.message : 'Umbenennen fehlgeschlagen');
      });
  }

  function doRemove(sticker: StickerInfo) {
    if (!window.confirm(`Sticker „${sticker.name}“ wirklich löschen?`)) return;
    useStickersStore
      .getState()
      .remove(serverId, sticker.id)
      .catch((err: unknown) => {
        setLocalError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
      });
  }

  const error = localError ?? storeError;

  return (
    <div
      className="animate-pop-in absolute right-0 bottom-full z-20 mb-2 w-full max-w-sm overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
      data-testid="sticker-picker"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="text-sm font-semibold text-zinc-200">Sticker</span>
        {canManage && (
          <button
            type="button"
            data-testid="sticker-upload-button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700/50"
          >
            + Hochladen
          </button>
        )}
        <button
          type="button"
          title="Schließen"
          onClick={onClose}
          className="ml-auto rounded px-1.5 py-0.5 text-sm text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          chooseFile(e.target.files);
          e.target.value = ''; // gleiche Datei erneut wählbar
        }}
        data-testid="sticker-file-input"
      />

      {error && <p className="border-b border-red-900 px-3 py-1.5 text-xs text-red-400">{error}</p>}

      {pendingFile && (
        <div className="border-b border-zinc-800 px-3 py-2" data-testid="sticker-upload-form">
          <p className="truncate text-xs text-zinc-400">🖼️ {pendingFile.name}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              autoFocus
              value={uploadName}
              maxLength={MAX_STICKER_NAME_LENGTH}
              onChange={(e) => setUploadName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doUpload();
              }}
              placeholder="Sticker-Name"
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              className="shrink-0 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700/50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              data-testid="sticker-upload-submit"
              onClick={() => void doUpload()}
              disabled={busy || !uploadName.trim()}
              className="shrink-0 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? 'Lädt …' : 'Hochladen'}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto p-2">
        {loading && stickers.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-zinc-500">Lade Sticker …</p>
        ) : stickers.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-zinc-500">
            Noch keine Sticker auf diesem Server.
            {canManage ? ' Lade den ersten hoch!' : ''}
          </p>
        ) : (
          <ul className="grid grid-cols-4 gap-1.5">
            {stickers.map((sticker) => (
              <li key={sticker.id} className="group/tile relative">
                <button
                  type="button"
                  title={`Sticker „${sticker.name}“ senden`}
                  onClick={() => onPick(sticker)}
                  className="flex w-full flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-zinc-700/50"
                >
                  <StickerImage
                    stickerId={sticker.id}
                    mimeType={sticker.mimeType}
                    name={sticker.name}
                    className="h-14 w-14 object-contain"
                    fallback={
                      <span className="flex h-14 w-14 items-center justify-center text-2xl">
                        🏷️
                      </span>
                    }
                  />
                  <span className="w-full truncate text-center text-[10px] text-zinc-400">
                    {sticker.name}
                  </span>
                </button>
                {(canManage || sticker.uploaderId === me?.id) && (
                  <span className="absolute -top-1 -right-1 hidden gap-0.5 group-hover/tile:flex">
                    {canManage && (
                      <button
                        type="button"
                        title="Umbenennen"
                        onClick={() => doRename(sticker)}
                        className="rounded border border-zinc-700 bg-zinc-900 px-1 text-[10px] hover:bg-zinc-700"
                      >
                        ✏️
                      </button>
                    )}
                    <button
                      type="button"
                      title="Löschen"
                      onClick={() => doRemove(sticker)}
                      className="rounded border border-zinc-700 bg-zinc-900 px-1 text-[10px] hover:bg-red-900/60"
                    >
                      🗑️
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
