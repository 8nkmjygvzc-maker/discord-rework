import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Modal from './Modal';
import type { CropRect } from '../lib/profileImage';

interface ImageCropDialogProps {
  /** Zu beschneidende Bilddatei (bereits als Bild validiert). */
  file: File;
  /** Seitenverhältnis (Breite/Höhe) des Zielausschnitts, z. B. 680/240 fürs Banner. */
  aspect: number;
  title: string;
  onCancel: () => void;
  /** Liefert den gewählten Ausschnitt in Pixeln des Originalbilds. */
  onConfirm: (crop: CropRect) => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Ausschnitt-Wahl vor dem Upload: Das Bild liegt hinter einem Rahmen im
 * Ziel-Seitenverhältnis und lässt sich per Ziehen (Maus/Touch) verschieben
 * sowie per Slider, Mausrad oder Pinch-Geste zoomen. Zoom 1 = größtmöglicher
 * Ausschnitt (entspricht dem bisherigen Cover-Crop).
 */
export default function ImageCropDialog({
  file,
  aspect,
  title,
  onCancel,
  onConfirm,
}: ImageCropDialogProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  /** Natürliche Bildmaße, gesetzt sobald das Bild geladen ist. */
  const [img, setImg] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  /** Mittelpunkt des Ausschnitts in Pixeln des Originalbilds. */
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(0);
  /** Aktive Pointer für Drag (1 Finger/Maus) und Pinch-Zoom (2 Finger). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // Viewport-Breite beobachten (Modal ist responsive, z. B. auf Mobile).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setViewportW(el.clientWidth));
    observer.observe(el);
    setViewportW(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Abgeleitete Geometrie: Ausschnitt in Originalpixeln + Skalierung zur Anzeige.
  const cropW = img ? Math.min(img.w, img.h * aspect) / zoom : 0;
  const cropH = cropW / aspect;
  const cropX = img ? clamp(center.x - cropW / 2, 0, img.w - cropW) : 0;
  const cropY = img ? clamp(center.y - cropH / 2, 0, img.h - cropH) : 0;
  /** Anzeige-Pixel pro Original-Pixel. */
  const scale = cropW > 0 ? viewportW / cropW : 0;

  /** Zoom setzen und den Mittelpunkt im gültigen Bereich halten. */
  function applyZoom(nextZoom: number) {
    const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    // Ref sofort mitführen: Wheel-/Pinch-Events feuern schneller als React
    // rendert – sonst rechnen Folge-Events mit veraltetem Zoom.
    zoomRef.current = z;
    setZoom(z);
    if (img) {
      const w = Math.min(img.w, img.h * aspect) / z;
      const h = w / aspect;
      setCenter((c) => ({
        x: clamp(c.x, w / 2, img.w - w / 2),
        y: clamp(c.y, h / 2, img.h - h / 2),
      }));
    }
  }

  // Mausrad-Zoom: nativer Listener, weil Reacts onWheel passiv ist und
  // preventDefault (kein Seiten-Scroll hinterm Modal) sonst wirkungslos wäre.
  const zoomRef = useRef(MIN_ZOOM);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // Neu binden, sobald das Bild geladen ist: applyZoom hält img im Closure.
  }, [img]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !img || scale <= 0) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.current.size === 2) {
      // Pinch-Zoom: Abstandsänderung der beiden Finger → Zoomfaktor.
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const distBefore = Math.hypot(prev.x - other.x, prev.y - other.y);
      const distAfter = Math.hypot(next.x - other.x, next.y - other.y);
      if (distBefore > 0) applyZoom(zoomRef.current * (distAfter / distBefore));
    } else {
      // Ziehen: Fingerbewegung nach rechts zeigt weiter links liegenden Inhalt.
      setCenter((c) => ({
        x: clamp(c.x - (next.x - prev.x) / scale, cropW / 2, img.w - cropW / 2),
        y: clamp(c.y - (next.y - prev.y) / scale, cropH / 2, img.h - cropH / 2),
      }));
    }
    pointers.current.set(e.pointerId, next);
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
  }

  function confirm() {
    if (!img) return;
    onConfirm({
      x: Math.round(cropX),
      y: Math.round(cropY),
      width: Math.round(cropW),
      height: Math.round(cropH),
    });
  }

  return (
    <Modal title={title} onClose={onCancel}>
      {error ? (
        <p className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400">
          Das Bild konnte nicht gelesen werden.
        </p>
      ) : (
        <>
          <div
            ref={viewportRef}
            data-testid="crop-viewport"
            className="relative w-full cursor-move touch-none overflow-hidden rounded-lg border border-zinc-600 bg-zinc-900 select-none"
            style={{ aspectRatio: `${aspect}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            {url && (
              <img
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setImg({ w: el.naturalWidth, h: el.naturalHeight });
                  setCenter({ x: el.naturalWidth / 2, y: el.naturalHeight / 2 });
                }}
                onError={() => setError(true)}
                // max-w-none: Tailwinds img { max-width:100% } würde die Geometrie zerstören.
                className="absolute top-0 left-0 max-w-none"
                style={
                  img && scale > 0
                    ? {
                        width: img.w * scale,
                        height: img.h * scale,
                        transform: `translate(${-cropX * scale}px, ${-cropY * scale}px)`,
                      }
                    : { visibility: 'hidden' }
                }
              />
            )}
            {!img && !error && (
              <span className="absolute inset-0 flex items-center justify-center text-sm text-zinc-500">
                Lade Bild …
              </span>
            )}
          </div>

          <label className="mt-4 flex items-center gap-3 text-sm text-zinc-300">
            <span className="shrink-0">Zoom</span>
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!img}
              onChange={(e) => applyZoom(Number(e.target.value))}
              className="w-full accent-indigo-500"
              data-testid="crop-zoom"
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            Zum Verschieben ziehen, zoomen per Regler, Mausrad oder zwei Fingern.
          </p>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirm}
              disabled={!img}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="crop-confirm"
            >
              Übernehmen
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-zinc-600 px-4 py-2 font-semibold text-zinc-300 transition hover:bg-zinc-700"
            >
              Abbrechen
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
