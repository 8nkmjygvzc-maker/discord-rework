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

  /**
   * „Rang“ eines Mitglieds für die Moderations-Hierarchie (Phase 13): die
   * höchste Position seiner zugewiesenen Rollen (die Standardrolle liegt bei 0).
   * Der Owner steht über allem (+∞), Nicht-Mitglieder liefern null. Ein Mitglied
   * darf nur Ziele mit STRIKT niedrigerem Rang moderieren – so kann niemand
   * gleich- oder höherrangige Mitglieder (oder den Owner) kicken/bannen/timeouten.
   */
  async getMemberRank(serverId: string, userId: string): Promise<number | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      include: {
        server: { select: { ownerId: true } },
        roles: { include: { role: { select: { position: true } } } },
      },
    });
    if (!membership) return null;
    if (membership.server.ownerId === userId) return Number.POSITIVE_INFINITY;

    let rank = 0;
    for (const assignment of membership.roles) {
      if (assignment.role.position > rank) rank = assignment.role.position;
    }
    return rank;
  }

  /**
   * IDs aller Mitglieder, deren effektive Rechte `required` enthalten – für
   * gezielte Gateway-Dispatches (z. B. MESSAGE_CREATE nur an Mitglieder mit
   * ViewChannels). Rechnet die Bitfelder in einem Rutsch im Speicher aus,
   * statt getMemberPermissions pro Mitglied aufzurufen (N Queries).
   */
  async getMemberIdsWithPermission(serverId: string, required: bigint): Promise<string[]> {
    const [server, defaultRole, members] = await Promise.all([
      this.prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } }),
      this.prisma.role.findFirst({
        where: { serverId, isDefault: true },
        select: { permissions: true },
      }),
      this.prisma.membership.findMany({
        where: { serverId },
        select: {
          userId: true,
          roles: { select: { role: { select: { permissions: true } } } },
        },
      }),
    ]);
    if (!server) return [];

    const base = defaultRole?.permissions ?? 0n;
    return members
      .filter((member) => {
        if (member.userId === server.ownerId) return true;
        let granted = base;
        for (const assignment of member.roles) granted |= assignment.role.permissions;
        return hasPermission(granted, required);
      })
      .map((member) => member.userId);
  }
}
