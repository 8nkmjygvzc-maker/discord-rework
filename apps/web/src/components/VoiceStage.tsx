import { useEffect, useRef } from 'react';
import { useVoiceStore } from '../store/voice';
import type { VideoTile } from '../lib/voice';

/**
 * Video-Bühne (Phase 11). Zeigt alle aktiven Video-Streams – eigene Kamera/
 * Bildschirmfreigabe und die der anderen Teilnehmer – als Kachel-Raster über
 * dem Textchat. Erscheint nur, wenn tatsächlich Video läuft.
 */
export default function VoiceStage() {
  const videoTiles = useVoiceStore((s) => s.videoTiles);
  if (videoTiles.length === 0) return null;

  // Spaltenzahl grob an die Kachelanzahl anpassen (1 → 1, 2–4 → 2, ab 5 → 3).
  const cols = videoTiles.length === 1 ? 1 : videoTiles.length <= 4 ? 2 : 3;

  return (
    <div className="shrink-0 border-b border-zinc-950/50 bg-black/40 p-3">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {videoTiles.map((tile) => (
          <VideoTileView key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function VideoTileView({ tile }: { tile: VideoTile }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = new MediaStream([tile.track]);
    return () => {
      el.srcObject = null;
    };
  }, [tile.track]);

  const label =
    (tile.isLocal ? 'Du' : tile.username) +
    (tile.source === 'screen' ? ' · Bildschirm' : ' · Kamera');

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800">
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
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-zinc-100">
        {tile.source === 'screen' ? '🖥️' : '📹'} {label}
      </span>
    </div>
  );
}
