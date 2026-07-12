/**
 * Runder Nutzer-/Server-Avatar (Phase 15): zeigt das hochgeladene Bild oder
 * – ohne Bild – die Initiale auf einer Farbfläche. Größe kommt als
 * Tailwind-Klassen von außen (h-8 w-8 text-sm …).
 */
interface AvatarProps {
  name: string;
  avatarUrl: string | null | undefined;
  /** Tailwind-Größenklassen, z. B. "h-8 w-8 text-sm". */
  sizeClass: string;
  /** Hintergrund des Initialen-Platzhalters (Standard: zinc). */
  fallbackClass?: string;
  className?: string;
}

export default function Avatar({
  name,
  avatarUrl,
  sizeClass,
  fallbackClass = 'bg-zinc-700',
  className = '',
}: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        draggable={false}
        className={`${sizeClass} shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full font-bold text-white ${fallbackClass} ${className}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
