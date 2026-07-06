import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  Permissions,
  permissionsFromString,
  permissionsToString,
  RoleInfo,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from './permissions.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

/** Maske aller definierten Bits – unbekannte Bits werden beim Schreiben verworfen. */
const KNOWN_PERMISSIONS_MASK: bigint = Object.values(Permissions).reduce((a, b) => a | b, 0n);

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
  ) {}

  async create(serverId: string, userId: string, dto: CreateRoleDto): Promise<RoleInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageRoles);
    const last = await this.prisma.role.findFirst({
      where: { serverId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const role = await this.prisma.role.create({
      data: { serverId, name: dto.name, position: (last?.position ?? 0) + 1 },
    });
    const info = toRoleInfo(role);
    await this.publishToMembers(serverId, 'ROLE_CREATE', { role: info });
    return info;
  }

  async update(roleId: string, userId: string, dto: UpdateRoleDto): Promise<RoleInfo> {
    const role = await this.requireRole(roleId);
    await this.permissions.requirePermission(role.serverId, userId, Permissions.ManageRoles);

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        // Die Standardrolle behält ihren Namen – sie repräsentiert „alle Mitglieder“.
        name: role.isDefault ? undefined : dto.name,
        color: dto.color,
        position: role.isDefault ? undefined : dto.position,
        permissions:
          dto.permissions !== undefined
            ? permissionsFromString(dto.permissions) & KNOWN_PERMISSIONS_MASK
            : undefined,
      },
    });
    const info = toRoleInfo(updated);
    await this.publishToMembers(role.serverId, 'ROLE_UPDATE', { role: info });
    return info;
  }

  async delete(roleId: string, userId: string): Promise<void> {
    const role = await this.requireRole(roleId);
    await this.permissions.requirePermission(role.serverId, userId, Permissions.ManageRoles);
    if (role.isDefault) {
      throw new BadRequestException('Die Standardrolle kann nicht gelöscht werden');
    }
    await this.prisma.role.delete({ where: { id: roleId } });
    await this.publishToMembers(role.serverId, 'ROLE_DELETE', {
      serverId: role.serverId,
      roleId,
    });
  }

  /** Rolle einem Mitglied geben (assign=true) oder entziehen (assign=false). */
  async setMemberRole(
    serverId: string,
    targetUserId: string,
    roleId: string,
    actorId: string,
    assign: boolean,
  ): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.ManageRoles);

    const role = await this.requireRole(roleId);
    if (role.serverId !== serverId) throw new NotFoundException('Rolle nicht gefunden');
    if (role.isDefault) {
      throw new BadRequestException('Die Standardrolle gilt automatisch für alle Mitglieder');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId: targetUserId, serverId } },
    });
    if (!membership) throw new NotFoundException('Mitglied nicht gefunden');

    // Rechte des Owners sind unantastbar – Rollen ändern daran ohnehin nichts,
    // aber so bleibt die Zuweisungs-Liste sauber interpretierbar.
    if (assign) {
      await this.prisma.memberRole.upsert({
        where: { userId_serverId_roleId: { userId: targetUserId, serverId, roleId } },
        create: { userId: targetUserId, serverId, roleId },
        update: {},
      });
    } else {
      await this.prisma.memberRole.deleteMany({
        where: { userId: targetUserId, serverId, roleId },
      });
    }

    const roleIds = await this.memberRoleIds(serverId, targetUserId);
    await this.publishToMembers(serverId, 'MEMBER_ROLES_UPDATE', {
      serverId,
      userId: targetUserId,
      roleIds,
    });
  }

  async memberRoleIds(serverId: string, userId: string): Promise<string[]> {
    const assignments = await this.prisma.memberRole.findMany({
      where: { serverId, userId },
      select: { roleId: true },
    });
    return assignments.map((a) => a.roleId);
  }

  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Rolle nicht gefunden');
    return role;
  }

  private async publishToMembers(serverId: string, t: Parameters<GatewayService['publishDispatch']>[0], d: unknown): Promise<void> {
    const members = await this.prisma.membership.findMany({
      where: { serverId },
      select: { userId: true },
    });
    await this.gateway.publishDispatch(t, d, members.map((m) => m.userId));
  }
}

export function toRoleInfo(role: Role): RoleInfo {
  return {
    id: role.id,
    serverId: role.serverId,
    name: role.name,
    permissions: permissionsToString(role.permissions),
    color: role.color,
    position: role.position,
    isDefault: role.isDefault,
  };
}
