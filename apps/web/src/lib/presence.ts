import type { PresenceUser } from '@parley/shared';

/**
 * Sichtbarer Anwesenheits-Zustand eines ANDEREN Nutzers, abgeleitet aus der
 * Online-Liste des Presence-Stores. 'invisible' existiert hier bewusst nicht –
 * Unsichtbare filtert der Server aus allen Presence-Antworten, sie sind von
 * Offline nicht unterscheidbar.
 */
export type VisiblePresence = 'online' | 'dnd' | 'offline';

/** Map userId → sichtbarer Zustand aus der Online-Liste (fehlend = offline). */
export function presenceMap(onlineUsers: PresenceUser[]): Map<string, VisiblePresence> {
  return new Map(onlineUsers.map((u) => [u.id, u.presence ?? 'online']));
}

/** Tailwind-Farbe des Status-Punkts. */
export function presenceDotClass(presence: VisiblePresence | undefined): string {
  if (presence === 'dnd') return 'bg-red-500';
  if (presence === 'online') return 'bg-emerald-500';
  return 'bg-zinc-600';
}

/** Beschriftung (Tooltip/Statuszeile) des Zustands. */
export function presenceLabel(presence: VisiblePresence | undefined): string {
  if (presence === 'dnd') return 'Nicht stören';
  if (presence === 'online') return 'Online';
  return 'Offline';
}
