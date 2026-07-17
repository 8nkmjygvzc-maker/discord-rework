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
 * kombinierte Erstellen/Beitreten-Button, dazwischen 5 Server-Slots. Bewusst
 * OHNE Panel/Bogen-Hintergrund – nur die frei schwebenden Icons (Phase 15,
 * Nutzerwunsch). Bei mehr als 5 Servern blättert das Mausrad das sichtbare
 * Fenster weiter; eine schmale Scroll-Leiste unter den Icons erscheint nur
 * dann und lässt sich ziehen.
 *
 * Das Dock ist standardmäßig verborgen und slidet erst hoch, wenn die Maus
 * unten in die Bildschirmmitte fährt (unsichtbare Auslöse-Zone). Es liegt als
 * Overlay über dem Inhalt – in der Server-Ansicht also über dem Chat – und
 * fährt wieder runter, sobald die Maus es verlässt.
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
  // Dock eingeblendet? Wird über die Mausposition (Zone unten mittig) gesteuert.
  const [visible, setVisible] = useState(false);
  // Neue DM/Anfrage: Dock kurz zeigen + Zuhause-Icon „ploppen“ lassen.
  const [peek, setPeek] = useState(false);
  // Zähler statt Boolean: dient als `key` des Buttons, damit die CSS-Animation
  // bei jeder neuen Nachricht frisch startet (auch in Hintergrund-Tabs, wo
  // requestAnimationFrame pausiert – deshalb kein rAF-Neustart-Trick).
  const [popSeq, setPopSeq] = useState(0);
  const prevBadge = useRef(homeBadge);
  const peekTimer = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const maxOffset = Math.max(0, servers.length - SLOTS);

  // Badge gestiegen → Dock einige Sekunden einblenden und Icon animieren
  // (Verbesserungs-Runde: sonst bliebe eine neue Nachricht unbemerkt, weil
  // das Dock standardmäßig verborgen ist).
  useEffect(() => {
    if (homeBadge > prevBadge.current) {
      setPeek(true);
      setPopSeq((n) => n + 1);
      if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
      peekTimer.current = window.setTimeout(() => setPeek(false), 3_000);
    }
    prevBadge.current = homeBadge;
  }, [homeBadge]);

  useEffect(
    () => () => {
      if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
    },
    [],
  );

  // Globale Mausverfolgung: einblenden, wenn der Cursor unten mittig ankommt;
  // ausblenden, sobald er das Dock-Areal wieder verlässt (außer Menü ist offen).
  // Bewusst nicht über mouseenter/-leave gelöst – das feuert nicht zuverlässig,
  // z. B. wenn die Maus das Fenster verlässt.
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      const inTriggerZone =
        e.clientY >= window.innerHeight - 16 && Math.abs(e.clientX - window.innerWidth / 2) <= 280;
      if (inTriggerZone) {
        setVisible(true);
        return;
      }
      if (menuOpen || peek) return;
      const rect = navRef.current?.getBoundingClientRect();
      const overDock =
        !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top - 8;
      if (!overDock) setVisible(false);
    }
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [menuOpen, peek]);

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

  // Hover: leichtes Anwachsen + Anheben (Dock-Gefühl ohne Panel dahinter).
  const circle =
    'flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white shadow-lg shadow-black/40 transition-all duration-150 hover:-translate-y-1.5 hover:scale-110';

  return (
    <nav
      ref={navRef}
      onWheel={handleWheel}
      // Tastatur-Fokus (Tab) blendet das Dock ebenfalls ein.
      onFocusCapture={() => setVisible(true)}
      // max-md:hidden – auf dem Handy wandert die Server-Leiste in den
      // Navigations-Drawer (MobileServerRail in MainPage), das Hover-Dock
      // funktioniert ohne Maus ohnehin nicht.
      className={`absolute bottom-0 left-1/2 z-40 -translate-x-1/2 px-8 pt-4 pb-3 transition-all duration-300 ease-out max-md:hidden ${
        visible || peek ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
      }`}
      data-testid="server-dock"
    >
      <div className="flex flex-col items-center">
        {/* Obere Reihe: Freunde (fix) | 5 Server-Slots | Erstellen/Beitreten (fix) */}
        <div className="z-10 flex items-end gap-3">
          <button
            key={popSeq}
            type="button"
            title="Freunde & Direktnachrichten"
            onClick={onSelectHome}
            className={`relative ${circle} ${popSeq > 0 ? 'animate-badge-pop' : ''} ${
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

          {visibleSlots.map((server) =>
            server ? (
              <button
                key={server.id}
                type="button"
                title={server.name}
                onClick={() => onSelectServer(server.id)}
                className={`${circle} overflow-hidden ${
                  !homeActive && server.id === selectedId
                    ? 'bg-indigo-600'
                    : 'bg-zinc-700 hover:bg-indigo-500'
                }`}
              >
                {server.iconUrl ? (
                  <img
                    src={server.iconUrl}
                    alt={server.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  server.name.slice(0, 1).toUpperCase()
                )}
              </button>
            ) : null,
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

        {/* Schmale Scroll-Leiste unter den Icons – nur bei mehr als 5 Servern. */}
        {scrollable && (
          <div
            ref={trackRef}
            title="Server durchscrollen"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scrubToPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) scrubToPointer(e.clientX);
            }}
            className="relative mt-2 h-1.5 w-72 cursor-pointer touch-none rounded-full bg-zinc-700/40"
            data-testid="server-scrollbar"
          >
            <div
              className="absolute top-0 h-full rounded-full bg-zinc-400/80 transition-[left] duration-100 hover:bg-zinc-300"
              style={{ width: `${thumbWidthPct}%`, left: `${thumbLeftPct}%` }}
            />
          </div>
        )}
      </div>
    </nav>
  );
}
