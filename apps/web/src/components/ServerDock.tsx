import { useEffect, useRef, useState } from 'react';
import { useServersStore } from '../store/servers';
import { useFriendsStore } from '../store/friends';
import { useDmsStore } from '../store/dms';

/** Anzahl gleichzeitig sichtbarer Server-Slots zwischen den fixen Buttons. */
const SLOTS = 5;

interface ServerDockProps {
  /** true = Home-Ansicht (DMs/Freunde) ist aktiv. */
  homeActive: boolean;
  onSelectHome: () => void;
  onSelectServer: (serverId: string) => void;
  onCreateServer: () => void;
  onJoinServer: () => void;
}

/**
 * Unten mittig zentriertes Dock: links fix der Freunde-Tab, rechts fix der
 * kombinierte Erstellen/Beitreten-Button, dazwischen 5 Server-Slots. Bei mehr
 * als 5 Servern verschiebt die Scroll-Leiste im Bogen darunter das sichtbare
 * Fenster (auch per Mausrad über dem Dock).
 */
export default function ServerDock({
  homeActive,
  onSelectHome,
  onSelectServer,
  onCreateServer,
  onJoinServer,
}: ServerDockProps) {
  const servers = useServersStore((s) => s.servers);
  const selectedId = useServersStore((s) => s.selectedServer?.id);
  const incomingCount = useFriendsStore((s) => s.list.incoming.length);
  // Ungelesene DMs (Phase 15) zählen mit auf den Freunde-Badge.
  const unreadDmCount = useDmsStore((s) => Object.values(s.unread).reduce((sum, n) => sum + n, 0));
  const homeBadge = incomingCount + unreadDmCount;

  // Erster sichtbarer Server-Index (Fenster der Größe SLOTS).
  const [offset, setOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const maxOffset = Math.max(0, servers.length - SLOTS);

  // Fenster im gültigen Bereich halten, wenn Server wegfallen.
  useEffect(() => {
    setOffset((o) => Math.min(o, maxOffset));
  }, [maxOffset]);

  // Ausgewählten Server automatisch ins sichtbare Fenster holen
  // (z. B. nach Erstellen/Beitreten, wenn er außerhalb liegt).
  useEffect(() => {
    if (!selectedId) return;
    const idx = servers.findIndex((s) => s.id === selectedId);
    if (idx === -1) return;
    setOffset((o) => (idx < o ? idx : idx >= o + SLOTS ? idx - SLOTS + 1 : o));
  }, [selectedId, servers]);

  /** Mausrad über dem Dock blättert das Server-Fenster weiter. */
  function handleWheel(e: React.WheelEvent) {
    if (maxOffset === 0) return;
    const dir = e.deltaY > 0 || e.deltaX > 0 ? 1 : -1;
    setOffset((o) => Math.max(0, Math.min(maxOffset, o + dir)));
  }

  /** Rechnet eine Zeigerposition auf der Leiste in einen Fenster-Offset um. */
  function scrubToPointer(clientX: number) {
    const track = trackRef.current;
    if (!track || maxOffset === 0) return;
    const rect = track.getBoundingClientRect();
    const thumbWidth = rect.width * (SLOTS / servers.length);
    const usable = rect.width - thumbWidth;
    if (usable <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - thumbWidth / 2) / usable));
    setOffset(Math.round(ratio * maxOffset));
  }

  const scrollable = maxOffset > 0;
  const thumbWidthPct = scrollable ? (SLOTS / servers.length) * 100 : 100;
  const thumbLeftPct = scrollable ? (offset / maxOffset) * (100 - thumbWidthPct) : 0;

  const visibleSlots = Array.from({ length: SLOTS }, (_, i) => servers[offset + i] ?? null);

  const circle =
    'flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white shadow-md transition-colors';

  return (
    <nav
      onWheel={handleWheel}
      className="relative z-20 flex shrink-0 justify-center bg-zinc-950 pt-3"
      data-testid="server-dock"
    >
      <div className="flex flex-col items-center">
        {/* Obere Reihe: Freunde (fix) | 5 Server-Slots | Erstellen/Beitreten (fix) */}
        <div className="z-10 flex items-end gap-3">
          <button
            type="button"
            title="Freunde & Direktnachrichten"
            onClick={onSelectHome}
            className={`relative ${circle} ${
              homeActive ? 'bg-indigo-600' : 'bg-zinc-700 hover:bg-indigo-500'
            }`}
            data-testid="home-button"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
              <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-6 2.02-6 4.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5c0-2.48-2.69-4.5-6-4.5Zm7.5-2a3.5 3.5 0 1 0-2.63-5.8 5.98 5.98 0 0 1 .4 4.99c.63.5 1.4.81 2.23.81Zm.5 2c-.55 0-1.08.07-1.58.2 1.28 1.02 2.08 2.4 2.08 4.3V19h3a1 1 0 0 0 1-1v-.5c0-2.48-2.02-4.5-4.5-4.5Z" />
            </svg>
            {homeBadge > 0 && (
              <span
                title={`${incomingCount} offene Freundschaftsanfrage(n), ${unreadDmCount} ungelesene Direktnachricht(en)`}
                className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-zinc-950 bg-red-500 text-[10px] font-bold"
              >
                {homeBadge > 9 ? '9+' : homeBadge}
              </span>
            )}
          </button>

          {visibleSlots.map((server, i) =>
            server ? (
              <button
                key={server.id}
                type="button"
                title={server.name}
                onClick={() => onSelectServer(server.id)}
                className={`${circle} ${
                  !homeActive && server.id === selectedId
                    ? 'bg-indigo-600'
                    : 'bg-zinc-700 hover:bg-indigo-500'
                }`}
              >
                {server.name.slice(0, 1).toUpperCase()}
              </button>
            ) : (
              <div
                key={`slot-${i}`}
                title="Freier Server-Slot"
                className="h-14 w-14 rounded-full border-2 border-dashed border-zinc-700/70 bg-zinc-800/40"
              />
            ),
          )}

          <div className="relative">
            <button
              type="button"
              title="Server erstellen oder beitreten"
              onClick={() => setMenuOpen((v) => !v)}
              className={`${circle} text-2xl ${
                menuOpen
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-700 text-emerald-400 hover:bg-emerald-600 hover:text-white'
              }`}
              data-testid="server-add-button"
            >
              +
            </button>

            {menuOpen && (
              <>
                {/* Unsichtbare Fläche: Klick daneben schließt das Menü. */}
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute bottom-full left-1/2 z-40 mb-3 w-60 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onCreateServer();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-200 transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="text-lg leading-none text-emerald-400">+</span>
                    Server erstellen
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onJoinServer();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-200 transition hover:bg-emerald-600 hover:text-white"
                  >
                    <span className="text-lg leading-none text-emerald-400">→</span>
                    Server beitreten (mit Einladung)
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Bogen (Schale) unter den Kreisen, mit Scroll-Leiste darin. */}
        <div className="relative -mt-3 h-16 w-[560px]">
          <svg
            viewBox="0 0 560 64"
            preserveAspectRatio="none"
            className="h-full w-full"
            aria-hidden
          >
            <defs>
              <linearGradient id="dock-hull" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#3f3f46" />
                <stop offset="1" stopColor="#18181b" />
              </linearGradient>
            </defs>
            <path d="M0 12 Q280 0 560 12 L554 22 Q280 68 6 22 Z" fill="url(#dock-hull)" />
            <path d="M0 12 Q280 0 560 12" fill="none" stroke="#52525b" strokeWidth="1.5" />
          </svg>

          <div
            ref={trackRef}
            title={scrollable ? 'Server durchscrollen' : undefined}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubToPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) scrubToPointer(e.clientX);
            }}
            className={`absolute top-[26px] left-1/2 h-2 w-72 -translate-x-1/2 touch-none rounded-full bg-zinc-900/80 ${
              scrollable ? 'cursor-pointer' : ''
            }`}
            data-testid="server-scrollbar"
          >
            <div
              className={`absolute top-0 h-full rounded-full transition-[left] duration-100 ${
                scrollable ? 'bg-zinc-500 hover:bg-zinc-400' : 'bg-zinc-700/60'
              }`}
              style={{ width: `${thumbWidthPct}%`, left: `${thumbLeftPct}%` }}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
