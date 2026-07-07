import { useEffect, useState } from 'react';
import type { AttachmentMeta } from '@parley/shared';
import {
  formatBytes,
  getDecryptedObjectUrl,
  saveAttachmentToDisk,
  THUMBNAIL_MAX_PX,
} from '../lib/attachments';

/**
 * Anzeige-Größe des Vorschaubilds. width/height stammen aus den E2EE-Metadaten
 * des ABSENDERS – ein bösartiges Mitglied könnte dort absurde Werte eintragen,
 * deshalb hier klemmen statt blind übernehmen (ehrliche Thumbnails sind ohnehin
 * nie größer als THUMBNAIL_MAX_PX).
 */
function thumbnailBoxSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { width: THUMBNAIL_MAX_PX / 2, height: THUMBNAIL_MAX_PX / 2 };
  }
  const scale = Math.min(1, THUMBNAIL_MAX_PX / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Ein Anhang in einer Nachricht: Bilder mit entschlüsseltem Vorschaubild
 * (Klick = Original herunterladen), alles andere als Datei-Chip.
 */
export default function AttachmentView({ meta }: { meta: AttachmentMeta }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setDownloading(true);
    setError(null);
    try {
      await saveAttachmentToDisk(meta);
    } catch {
      setError('Download fehlgeschlagen');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="mt-1">
      {meta.thumbnail ? (
        <ThumbnailButton meta={meta} onClick={() => void onDownload()} />
      ) : (
        <div className="flex max-w-sm items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2">
          <span aria-hidden>📄</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-zinc-200">{meta.name}</p>
            <p className="text-xs text-zinc-500">{formatBytes(meta.sizeBytes)}</p>
          </div>
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={downloading}
            className="rounded bg-zinc-800 px-2.5 py-1 text-xs font-semibold text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            {downloading ? '…' : 'Speichern'}
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function ThumbnailButton({ meta, onClick }: { meta: AttachmentMeta; onClick: () => void }) {
  const thumbnail = meta.thumbnail!;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // Vorschaubilder sind immer JPEG (siehe makeThumbnail in lib/attachments.ts).
    getDecryptedObjectUrl(thumbnail, 'image/jpeg').then(
      (objectUrl) => active && setUrl(objectUrl),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [thumbnail]);

  if (failed) {
    return <p className="text-xs text-zinc-500 italic">Vorschau konnte nicht geladen werden.</p>;
  }
  const box = thumbnailBoxSize(thumbnail.width, thumbnail.height);
  return (
    <button
      type="button"
      title={`${meta.name} (${formatBytes(meta.sizeBytes)}) – klicken zum Speichern`}
      onClick={onClick}
      className="block overflow-hidden rounded-lg border border-zinc-700/60 focus:outline-2 focus:outline-indigo-500"
      style={{ width: box.width, height: box.height, maxWidth: '100%' }}
    >
      {url ? (
        <img
          src={url}
          alt={meta.name}
          width={box.width}
          height={box.height}
          className="block h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-zinc-900/60 text-xs text-zinc-500">
          Lädt …
        </span>
      )}
    </button>
  );
}
