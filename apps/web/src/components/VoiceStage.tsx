import { useEffect, useRef, useState } from 'react';
import { useVoiceStore } from '../store/voice';
import type { VideoTile } from '../lib/voice';

/**
 * Video-Bühne (Phase 11, Layout-Feinschliff Phase 15). Zeigt alle aktiven
 * Video-Streams – eigene Kamera/Bildschirmfreigabe und die der anderen –
 * über dem Textchat. Erscheint nur, wenn tatsächlich Video läuft.
 *
 * Layout: Läuft eine Bildschirmfreigabe, wird sie automatisch groß dargestellt
 * (fremde vor der eigenen), alle übrigen Streams wandern in eine kleine
 * Thumbnail-Leiste darunter. Per Klick lässt sich jede Kachel anpinnen
 * (Fokus-Ansicht); ein Klick auf die große Kachel löst den Pin wieder.
 * Ohne Bildschirmfreigabe und ohne Pin: das bisherige Kachel-Raster.
 * Wer gerade spricht, bekommt einen grünen Ring um seine Kachel.
 *
 * Verbesserungs-Runde: Die Fokus-Kachel ist über einen Zieh-Griff unter der
 * Bühne in der Höhe verstellbar, und jede Kachel hat einen Vollbild-Button
 * (Fullscreen-API) – wichtig für Bildschirmfreigaben.
 */

/** Grenzen für die verstellbare Höhe der Fokus-Kachel. */
const MIN_FOCUS_HEIGHT = 140;
const MAX_FOCUS_HEIGHT_RATIO = 0.8;

function clampFocusHeight(px: number): number {
  return Math.min(
    Math.round(window.innerHeight * MAX_FOCUS_HEIGHT_RATIO),
    Math.max(MIN_FOCUS_HEIGHT, px),
  );
}

export default function VoiceStage() {
  const videoTiles = useVoiceStore((s) => s.videoTiles);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  // Höhe der Fokus-Kachel (vorher fix 40vh) – per Griff verstellbar.
  const [focusHeight, setFocusHeight] = useState(() => clampFocusHeight(window.innerHeight * 0.4));
  const dragStart = useRef<{ y: number; height: number } | null>(null);

  // Angepinnte Kachel verschwunden (Stream/Teilnehmer weg) → Pin lösen.
  useEffect(() => {
    if (pinnedId && !videoTiles.some((t) => t.id === pinnedId)) setPinnedId(null);
  }, [pinnedId, videoTiles]);

  if (videoTiles.length === 0) return null;

  const pinned = videoTiles.find((t) => t.id === pinnedId) ?? null;
  const autoFocus =
    videoTiles.find((t) => t.source === 'screen' && !t.isLocal) ??
    videoTiles.find((t) => t.source === 'screen') ??
    null;
  const focused = pinned ?? autoFocus;

  if (focused) {
    const others = videoTiles.filter((t) => t.id !== focused.id);
    return (
      <div className="shrink-0 border-b border-zinc-950/50 bg-black/40 p-3 pb-1">
        <VideoTileView
          tile={focused}
          mode="focus"
          pinned={pinned !== null}
          focusHeight={focusHeight}
          onClick={() => setPinnedId(pinned ? null : focused.id)}
        />
        {others.length > 0 && (
          <div className="chat-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
            {others.map((tile) => (
              <VideoTileView
                key={tile.id}
                tile={tile}
                mode="thumb"
                pinned={false}
                onClick={() => setPinnedId(tile.id)}
              />
            ))}
          </div>
        )}
        {/* Zieh-Griff: Höhe der Fokus-Kachel anpassen (Verbesserungs-Runde). */}
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Ziehen, um die Videogröße anzupassen"
          data-testid="stage-resize-handle"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragStart.current = { y: e.clientY, height: focusHeight };
          }}
          onPointerMove={(e) => {
            if (!dragStart.current) return;
            setFocusHeight(
              clampFocusHeight(dragStart.current.height + (e.clientY - dragStart.current.y)),
            );
          }}
          onPointerUp={() => {
            dragStart.current = null;
          }}
          className="group mt-1 flex h-3 cursor-row-resize touch-none items-center justify-center"
        >
          <div className="h-1 w-16 rounded-full bg-zinc-600/60 transition group-hover:bg-zinc-400" />
        </div>
      </div>
    );
  }

  // Spaltenzahl grob an die Kachelanzahl anpassen (1 → 1, 2–4 → 2, ab 5 → 3).
  const cols = videoTiles.length === 1 ? 1 : videoTiles.length <= 4 ? 2 : 3;

  return (
    <div className="shrink-0 border-b border-zinc-950/50 bg-black/40 p-3">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {videoTiles.map((tile) => (
          <VideoTileView
            key={tile.id}
            tile={tile}
            mode="grid"
            pinned={false}
            onClick={() => setPinnedId(tile.id)}
          />
        ))}
      </div>
    </div>
  );
}

function VideoTileView({
  tile,
  mode,
  pinned,
  focusHeight,
  onClick,
}: {
  tile: VideoTile;
  mode: 'grid' | 'focus' | 'thumb';
  pinned: boolean;
  /** Nur im focus-Modus gesetzt: verstellbare Höhe in px. */
  focusHeight?: number;
  onClick: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const speaking = useVoiceStore((s) => s.speaking[tile.userId] === true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([tile.track]);
    return () => {
      el.srcObject = null;
    };
  }, [tile.track]);

  /** Vollbild für diese Kachel togglen (Verbesserungs-Runde). */
  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  }

  const name = tile.isLocal ? 'Du' : tile.username;
  // In der Thumbnail-Leiste nur der Name – für den Rest fehlt der Platz.
  const label =
    mode === 'thumb' ? name : `${name}${tile.source === 'screen' ? ' · Bildschirm' : ' · Kamera'}`;
  const sizing =
    mode === 'focus' ? 'w-full' : mode === 'thumb' ? 'aspect-video h-20 shrink-0' : 'aspect-video';

  return (
    <div
      ref={containerRef}
      role="button"
      tabIndex={0}
      title={mode === 'focus' ? (pinned ? 'Fokus lösen' : 'Kachel anpinnen') : 'Kachel fokussieren'}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={mode === 'focus' ? { height: focusHeight } : undefined}
      className={`group/tile relative cursor-pointer overflow-hidden rounded-lg bg-zinc-900 ${sizing} ${
        speaking ? 'ring-2 ring-emerald-400' : 'ring-1 ring-zinc-800'
      }`}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        // Eigene Streams stumm (kein Echo) – Video hat ohnehin keinen Ton.
        muted={tile.isLocal}
        // Eigene Kamera spiegeln (wie ein Spiegel); Bildschirm nicht spiegeln.
        className={`h-full w-full object-contain ${
          tile.isLocal && tile.source === 'cam' ? '-scale-x-100' : ''
        }`}
      />
      <span className="absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs text-zinc-100">
        {pinned && mode === 'focus' ? '📌 ' : ''}
        {tile.source === 'screen' ? '🖥️' : '📹'} {label}
      </span>
      {/* Vollbild – in der Thumbnail-Leiste fehlt der Platz. */}
      {mode !== 'thumb' && (
        <button
          type="button"
          title="Vollbild"
          data-testid="tile-fullscreen"
          onClick={(e) => {
            e.stopPropagation();
            toggleFullscreen();
          }}
          className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-sm text-zinc-200 opacity-0 transition group-hover/tile:opacity-100 hover:bg-black/80 focus:opacity-100"
        >
          ⛶
        </button>
      )}
    </div>
  );
}
