import { ReactNode, useEffect, useState } from 'react';
import { getStickerImageUrl } from '../lib/stickers';

interface StickerImageProps {
  stickerId: string;
  /** image/*-Typ aus Referenz/Bibliothek; ohne ihn sniffen Browser das Format. */
  mimeType?: string;
  /** Sticker-Name für alt/title. */
  name: string;
  className: string;
  /** Anzeige, wenn das Bild nicht ladbar ist (gelöscht/fremder Server → 404). */
  fallback?: ReactNode;
}

/**
 * Lädt ein Sticker-Bild über den authentifizierten Endpunkt (pro Sticker-ID
 * gecacht, siehe lib/stickers.ts) und rendert es; bis dahin ein Platzhalter
 * in derselben Größe, damit das Layout nicht springt.
 */
export default function StickerImage({
  stickerId,
  mimeType,
  name,
  className,
  fallback = null,
}: StickerImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    getStickerImageUrl(stickerId, mimeType)
      .then((objectUrl) => {
        if (alive) setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [stickerId, mimeType]);

  if (failed) return <>{fallback}</>;
  if (!url) return <div className={`animate-pulse rounded bg-zinc-800/60 ${className}`} />;
  return (
    <img src={url} alt={name} title={name} draggable={false} className={`rounded ${className}`} />
  );
}
