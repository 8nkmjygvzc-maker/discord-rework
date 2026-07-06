import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasPermission, Permissions } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Zentrale Rechte-Auflösung (Phase 5). Effektive Rechte eines Mitglieds:
 *
 *   Owner                → Administrator (alles)
 *   sonst                → Standardrolle ∪ alle zugewiesenen Rollen (Bit-OR)
 *
 * Alle Endpunkte setzen Rechte SERVERSEITIG über requirePermission durch –
 * die UI blendet höchstens zusätzlich aus.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Effektive Rechte, oder null wenn der Nutzer kein Mitglied ist. */
  async getMemberPermissions(serverId: string, userId: string): Promise<bigint | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      include: {
        server: { select: { ownerId: true } },
        roles: { include: { role: { select: { permissions: true } } } },
      },
    });
    if (!membership) return null;
    if (membership.server.ownerId === userId) return Permissions.Administrator;

    const defaultRole = await this.prisma.role.findFirst({
      where: { serverId, isDefault: true },
      select: { permissions: true },
    });

    let granted = defaultRole?.permissions ?? 0n;
    for (const assignment of membership.roles) granted |= assignment.role.permissions;
    return granted;
  }

  /**
   * Wirft 404 für Nicht-Mitglieder (kein Existenz-Leak) und 403 bei fehlendem
   * Recht. Liefert die effektiven Rechte für weitergehende Checks.
   */
  async requirePermission(serverId: string, userId: string, required: bigint): Promise<bigint> {
    const granted = await this.getMemberPermissions(serverId, userId);
    if (granted === null) throw new NotFoundException('Server nicht gefunden');
    if (!hasPermission(granted, required)) {
      throw new ForbiddenException('Dir fehlt die Berechtigung dafür');
    }
    return granted;
  }
}
