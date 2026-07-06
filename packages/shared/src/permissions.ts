/**
 * Berechtigungs-Bitfield (Phase 5). BigInt, damit später beliebig viele Bits
 * möglich sind; über JSON wandert der Wert als Dezimal-String (`permissions`).
 */
export const Permissions = {
  /** Kanäle und Nachrichten sehen. */
  ViewChannels: 1n << 0n,
  /** Nachrichten in Textkanälen senden. */
  SendMessages: 1n << 1n,
  /** Kanäle anlegen, umbenennen, löschen. */
  ManageChannels: 1n << 2n,
  /** Rollen verwalten und zuweisen. */
  ManageRoles: 1n << 3n,
  /** Server umbenennen, Icon ändern. */
  ManageServer: 1n << 4n,
  /** Mitglieder entfernen (ab Phase 13). */
  KickMembers: 1n << 5n,
  /** Mitglieder bannen (ab Phase 13). */
  BanMembers: 1n << 6n,
  /** Fremde Nachrichten löschen (ab Phase 9/13). */
  ManageMessages: 1n << 7n,
  /** Alle Rechte, unabhängig von anderen Bits. */
  Administrator: 1n << 8n,
} as const;

export type PermissionName = keyof typeof Permissions;

/** Standardrechte der automatisch angelegten Server-Rolle („Mitglied“). */
export const DEFAULT_ROLE_PERMISSIONS: bigint = Permissions.ViewChannels | Permissions.SendMessages;

/** Für UI-Aufzählungen: Name, Bit und Beschreibung jedes Rechts. */
export const PERMISSION_LIST: { name: PermissionName; label: string }[] = [
  { name: 'ViewChannels', label: 'Kanäle sehen' },
  { name: 'SendMessages', label: 'Nachrichten senden' },
  { name: 'ManageChannels', label: 'Kanäle verwalten' },
  { name: 'ManageRoles', label: 'Rollen verwalten' },
  { name: 'ManageServer', label: 'Server verwalten' },
  { name: 'KickMembers', label: 'Mitglieder kicken' },
  { name: 'BanMembers', label: 'Mitglieder bannen' },
  { name: 'ManageMessages', label: 'Nachrichten verwalten' },
  { name: 'Administrator', label: 'Administrator (alle Rechte)' },
];

/** Prüft ein Bit; Administrator schaltet alles frei. */
export function hasPermission(granted: bigint, required: bigint): boolean {
  if ((granted & Permissions.Administrator) === Permissions.Administrator) return true;
  return (granted & required) === required;
}

/** JSON-sichere Serialisierung des Bitfields. */
export function permissionsToString(permissions: bigint): string {
  return permissions.toString(10);
}

export function permissionsFromString(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Rolle, wie die API sie ausliefert. */
export interface RoleInfo {
  id: string;
  serverId: string;
  name: string;
  /** Bitfield als Dezimal-String (BigInt ist nicht JSON-serialisierbar). */
  permissions: string;
  color: string | null;
  position: number;
  /** Die automatische Standardrolle – gilt für ALLE Mitglieder, nicht löschbar. */
  isDefault: boolean;
}

export interface CreateRoleRequest {
  name: string;
}

export interface UpdateRoleRequest {
  name?: string;
  permissions?: string;
  color?: string;
  position?: number;
}
