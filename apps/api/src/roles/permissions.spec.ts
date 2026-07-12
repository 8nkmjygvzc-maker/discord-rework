import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  Permissions,
  permissionsFromString,
  permissionsToString,
} from '@parley/shared';

describe('Permissions-Bitfield', () => {
  it('Standardrolle darf sehen und schreiben, aber nicht verwalten', () => {
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.ViewChannels)).toBe(true);
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.SendMessages)).toBe(true);
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.ManageChannels)).toBe(false);
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.ManageRoles)).toBe(false);
    // Soundboard: abspielen ja (wie Discords @everyone), verwalten nein.
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.UseSoundboard)).toBe(true);
    expect(hasPermission(DEFAULT_ROLE_PERMISSIONS, Permissions.ManageSoundboard)).toBe(false);
  });

  it('Administrator schaltet alle Rechte frei', () => {
    expect(hasPermission(Permissions.Administrator, Permissions.ManageServer)).toBe(true);
    expect(hasPermission(Permissions.Administrator, Permissions.BanMembers)).toBe(true);
  });

  it('mehrere Rollen kombinieren sich per Bit-OR', () => {
    const combined = Permissions.ViewChannels | Permissions.ManageChannels;
    expect(hasPermission(combined, Permissions.ManageChannels)).toBe(true);
    expect(hasPermission(combined, Permissions.SendMessages)).toBe(false);
  });

  it('String-Roundtrip bleibt verlustfrei, Müll wird zu 0', () => {
    const value = Permissions.SendMessages | Permissions.KickMembers;
    expect(permissionsFromString(permissionsToString(value))).toBe(value);
    expect(permissionsFromString('kein-bigint')).toBe(0n);
  });
});
