import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invite, Prisma } from '@prisma/client';
import {
  hasPermission,
  InviteInfo,
  InvitePreview,
  Permissions,
  ServerDetails,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../roles/permissions.service';
import { ServersService } from '../servers/servers.service';
import { CreateInviteDto } from './dto/create-invite.dto';

/** Zeichenvorrat & Länge der Einladungscodes (base62, gut teilbar/tippbar). */
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 8;

type InviteWithCreator = Invite & { creator: { username: string } };

/**
 * Einladungslinks (Phase 12). Erstellen/Auflisten/Widerrufen verlangt das
 * CreateInvite-Recht; Einlösen kann jeder angemeldete Nutzer mit gültigem Code.
 * Der eigentliche Beitritt läuft über ServersService.join (gleiche Broadcasts
 * wie der Server-ID-Beitritt aus Phase 3).
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly servers: ServersService,
  ) {}

  /** Erstellt einen Einladungslink (Recht: CreateInvite). */
  async create(serverId: string, userId: string, dto: CreateInviteDto): Promise<InviteInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.CreateInvite);
    const maxUses = dto.maxUses ?? null;
    const expiresAt = dto.expiresInSeconds
      ? new Date(Date.now() + dto.expiresInSeconds * 1000)
      : null;

    // Bei (sehr unwahrscheinlicher) Code-Kollision neu würfeln.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const invite = await this.prisma.invite.create({
          data: { code: generateCode(), serverId, createdBy: userId, maxUses, expiresAt },
          include: { creator: { select: { username: true } } },
        });
        return toInviteInfo(invite);
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new ConflictException('Konnte keinen freien Einladungscode erzeugen');
  }

  /** Alle Einladungen eines Servers (Recht: CreateInvite). */
  async list(serverId: string, userId: string): Promise<InviteInfo[]> {
    await this.permissions.requirePermission(serverId, userId, Permissions.CreateInvite);
    const invites = await this.prisma.invite.findMany({
      where: { serverId },
      include: { creator: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map(toInviteInfo);
  }

  /** Widerruft eine Einladung – Ersteller oder jemand mit ManageServer. */
  async revoke(code: string, userId: string): Promise<void> {
    const invite = await this.prisma.invite.findUnique({ where: { code } });
    if (!invite) throw new NotFoundException('Einladung nicht gefunden');
    if (invite.createdBy !== userId) {
      const perms = await this.permissions.getMemberPermissions(invite.serverId, userId);
      if (perms === null || !hasPermission(perms, Permissions.ManageServer)) {
        throw new ForbiddenException('Keine Berechtigung, diese Einladung zu widerrufen');
      }
    }
    await this.prisma.invite.delete({ where: { code } });
  }

  /**
   * Vorschau eines Codes (BEVOR man beitritt). Für jeden angemeldeten Nutzer;
   * verrät nur Servername + Mitgliederzahl. 404 bei ungültig/abgelaufen/erschöpft.
   */
  async preview(code: string, userId: string): Promise<InvitePreview> {
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      include: {
        server: { select: { name: true, _count: { select: { members: true } } } },
        creator: { select: { username: true } },
      },
    });
    if (!invite || isExhausted(invite)) {
      throw new NotFoundException('Einladung ist ungültig oder abgelaufen');
    }
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId: invite.serverId } },
    });
    return {
      code: invite.code,
      serverId: invite.serverId,
      serverName: invite.server.name,
      memberCount: invite.server._count.members,
      inviterUsername: invite.creator.username,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
      alreadyMember: membership !== null,
    };
  }

  /** Löst einen Code ein: verbraucht eine Nutzung (atomar) und tritt bei. */
  async accept(code: string, userId: string): Promise<ServerDetails> {
    const invite = await this.prisma.invite.findUnique({ where: { code } });
    if (!invite || isExhausted(invite)) {
      throw new NotFoundException('Einladung ist ungültig oder abgelaufen');
    }

    // Bereits Mitglied? Keine Nutzung verbrauchen, direkt die Details liefern.
    const existing = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId: invite.serverId } },
    });
    if (existing) return this.servers.getServerDetails(invite.serverId, userId);

    // Nutzung atomar verbrauchen – bei Limit nur, solange uses < maxUses
    // (verhindert Überschreiten bei gleichzeitigem Einlösen).
    if (invite.maxUses !== null) {
      const consumed = await this.prisma.invite.updateMany({
        where: { code, uses: { lt: invite.maxUses } },
        data: { uses: { increment: 1 } },
      });
      if (consumed.count === 0) {
        throw new NotFoundException('Einladung ist ungültig oder abgelaufen');
      }
    } else {
      await this.prisma.invite.update({ where: { code }, data: { uses: { increment: 1 } } });
    }

    try {
      return await this.servers.join(invite.serverId, userId);
    } catch (err) {
      // Race: zwischen Mitglieds-Check und Beitritt schon beigetreten → Details
      // zurückgeben (die verbrauchte Nutzung ist vernachlässigbar).
      if (err instanceof ConflictException) {
        return this.servers.getServerDetails(invite.serverId, userId);
      }
      throw err;
    }
  }
}

function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/** Abgelaufen ODER Nutzungslimit erreicht. */
function isExhausted(invite: Invite): boolean {
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return true;
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return true;
  return false;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function toInviteInfo(invite: InviteWithCreator): InviteInfo {
  return {
    code: invite.code,
    serverId: invite.serverId,
    createdBy: invite.creator.username,
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt.toISOString(),
  };
}
