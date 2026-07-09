import type { RoleInfo } from '@parley/shared';

/**
 * Anzeigefarbe eines Mitglieds (Phase 15): die Farbe seiner höchsten Rolle,
 * die eine Farbe gesetzt hat – wie bei Discord. null = Standardfarbe der UI.
 */
export function memberRoleColor(roles: RoleInfo[], roleIds: string[]): string | null {
  let best: { position: number; color: string } | null = null;
  for (const roleId of roleIds) {
    const role = roles.find((r) => r.id === roleId);
    if (!role?.color) continue;
    if (!best || role.position > best.position) {
      best = { position: role.position, color: role.color };
    }
  }
  return best?.color ?? null;
}
