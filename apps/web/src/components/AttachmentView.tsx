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
 * (Klick = große Vorschau/Lightbox mit Speichern-Button, Verbesserungs-Runde –
 * vorher startete der Klick direkt den Download), alles andere als Datei-Chip.
 */
export default function AttachmentView({ meta }: { meta: AttachmentMeta }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
        <ThumbnailButton meta={meta} onClick={() => setLightboxOpen(true)} />
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
      {lightboxOpen && (
        <ImageLightbox
          meta={meta}
          downloading={downloading}
          onDownload={() => void onDownload()}
          onClose={() => setLightboxOpen(false)}
        />
      )}
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
      title={`${meta.name} (${formatBytes(meta.sizeBytes)}) – klicken für große Vorschau`}
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

/**
 * Große Bild-Vorschau (Lightbox): entschlüsselt das ORIGINAL (nicht nur das
 * Thumbnail) und zeigt es bildschirmfüllend. Klick daneben oder Esc schließt;
 * Speichern startet den Download wie bisher.
 */
function ImageLightbox({
  meta,
  downloading,
  onDownload,
  onClose,
}: {
  meta: AttachmentMeta;
  downloading: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getDecryptedObjectUrl(meta, meta.mimeType).then(
      (objectUrl) => active && setUrl(objectUrl),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [meta]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/85 p-4"
      onClick={onClose}
      data-testid="image-lightbox"
    >
      <div className="flex items-center gap-3 pb-3" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 truncate text-sm text-zinc-200">
          {meta.name} <span className="text-zinc-500">({formatBytes(meta.sizeBytes)})</span>
        </p>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="ml-auto shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          {downloading ? '…' : '⬇ Speichern'}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen"
          className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {failed ? (
          <p className="text-sm text-zinc-400">Bild konnte nicht geladen werden.</p>
        ) : url ? (
          <img
            src={url}
            alt={meta.name}
            onClick={(e) => e.stopPropagation()}
            className="animate-pop-in max-h-full max-w-full rounded object-contain"
          />
        ) : (
          <p className="animate-pulse text-sm text-zinc-400">Wird entschlüsselt …</p>
        )}
      </div>
    </div>
  );
}
