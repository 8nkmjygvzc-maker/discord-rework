import type { PresenceMode as DbPresenceMode } from '@prisma/client';
import type { PresenceMode } from '@parley/shared';

/** DB-Enum (ONLINE/DND/INVISIBLE) → Wire-Format ('online'/'dnd'/'invisible'). */
export function presenceToWire(mode: DbPresenceMode): PresenceMode {
  return mode === 'DND' ? 'dnd' : mode === 'INVISIBLE' ? 'invisible' : 'online';
}

/** Wire-Format → DB-Enum. */
export function presenceToDb(mode: PresenceMode): DbPresenceMode {
  return mode === 'dnd' ? 'DND' : mode === 'invisible' ? 'INVISIBLE' : 'ONLINE';
}
