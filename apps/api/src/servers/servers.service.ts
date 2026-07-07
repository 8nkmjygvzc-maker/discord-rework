import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Membership, Server, User } from '@prisma/client';
import {
  ChannelInfo,
  DEFAULT_ROLE_PERMISSIONS,
  Permissions,
  permissionsToString,
  ServerDetails,
  ServerMember,
  ServerSummary,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PresenceService } from '../gateway/presence.service';
import { PermissionsService } from '../roles/permissions.service';
import { StorageService } from '../storage/storage.service';
import { toRoleInfo } from '../roles/roles.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

type MembershipWithUser = Membership & {
  user: Pick<User, 'username'>;
  roles: { roleId: string }[];
};

@Injectable()
export class ServersService {
  private readonly logger = new Logger(ServersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly presence: PresenceService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
  ) {}

  /** Legt Server + Owner-Mitgliedschaft + Standardkanal + Standardrolle an. */
  async createServer(userId: string, dto: CreateServerDto): Promise<ServerDetails> {
    const server = await this.prisma.server.create({
      data: {
        name: dto.name,
        ownerId: userId,
        members: { create: { userId } },
        channels: { create: { name: 'allgemein', position: 0 } },
        roles: {
          create: {
            name: 'Mitglied',
            isDefault: true,
            permissions: DEFAULT_ROLE_PERMISSIONS,
          },
        },
      },
    });
    return this.getServerDetails(server.id, userId);
  }

  /** Alle Server, in denen der Nutzer Mitglied ist (Reihenfolge: Beitritt). */
  async listMyServers(userId: string): Promise<ServerSummary[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { server: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => toServerSummary(m.server));
  }

  /** Vollansicht inkl. Kanälen, Mitgliedern, Rollen – nur für Mitglieder. */
  async getServerDetails(serverId: string, userId: string): Promise<ServerDetails> {
    const granted = await this.permissions.getMemberPermissions(serverId, userId);
    if (granted === null) throw new NotFoundException('Server nicht gefunden');

    const server = await this.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
    const [channels, members, roles] = await Promise.all([
      this.prisma.channel.findMany({
        where: { serverId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.membership.findMany({
        where: { serverId },
        include: {
          user: { select: { username: true } },
          roles: { select: { roleId: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.role.findMany({
        where: { serverId },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      }),
    ]);
    return {
      ...toServerSummary(server),
      channels: channels.map(toChannelInfo),
      members: members.map(toServerMember),
      roles: roles.map(toRoleInfo),
      myPermissions: permissionsToString(granted),
    };
  }

  async updateServer(
    serverId: string,
    userId: string,
    dto: UpdateServerDto,
  ): Promise<ServerSummary> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageServer);
    const server = await this.prisma.server.update({ where: { id: serverId }, data: dto });
    const summary = toServerSummary(server);
    await this.gateway.publishDispatch(
      'SERVER_UPDATE',
      { server: summary },
      await this.memberIds(serverId),
    );
    return summary;
  }

  /** Löschen bleibt bewusst dem Owner vorbehalten – auch Admins dürfen das nicht. */
  async deleteServer(serverId: string, userId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Server nicht gefunden');
    if (server.ownerId !== userId) {
      throw new ForbiddenException('Nur der Server-Eigentümer darf den Server löschen');
    }
    // Empfänger und Kanal-IDs VOR dem Löschen einsammeln – die Cascade räumt
    // gleich Mitglieder und Kanäle (inkl. Attachment-Zeilen) mit ab.
    const memberIds = await this.memberIds(serverId);
    const channels = await this.prisma.channel.findMany({
      where: { serverId },
      select: { id: true },
    });
    await this.prisma.server.delete({ where: { id: serverId } });
    this.removeChannelBlobs(channels.map((c) => c.id));
    await this.gateway.publishDispatch('SERVER_DELETE', { serverId }, memberIds);
  }

  /** Beitritt per Server-ID; richtige Invite-Links folgen in Phase 12. */
  async join(serverId: string, userId: string): Promise<ServerDetails> {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) throw new NotFoundException('Server nicht gefunden');

    const existing = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
    });
    if (existing) throw new ConflictException('Du bist bereits Mitglied dieses Servers');

    const membership = await this.prisma.membership.create({
      data: { userId, serverId },
      include: { user: { select: { username: true } }, roles: { select: { roleId: true } } },
    });
    const memberIds = await this.memberIds(serverId);
    await this.gateway.publishDispatch(
      'SERVER_MEMBER_ADD',
      { serverId, member: toServerMember(membership) },
      memberIds,
    );

    // Presence ist gescoped (Phase 7): Beitritt erweitert den Sichtbarkeits-
    // kreis, der READY-Snapshot ist aber vorbei → dem Beitretenden die
    // Online-Mitglieder nachliefern und ihn den Mitgliedern melden.
    const memberSet = new Set(memberIds);
    const onlineMembers = (await this.presence.getOnlineUsers()).filter((u) => memberSet.has(u.id));
    const joiner = onlineMembers.find((u) => u.id === userId);
    const others = onlineMembers.filter((u) => u.id !== userId);
    if (others.length > 0) {
      await this.gateway.publishDispatch('PRESENCE_SYNC', { users: others }, [userId]);
    }
    if (joiner) {
      await this.gateway.publishDispatch(
        'PRESENCE_UPDATE',
        { user: joiner, online: true },
        memberIds.filter((id) => id !== userId),
      );
    }
    return this.getServerDetails(serverId, userId);
  }

  async leave(serverId: string, userId: string): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      include: { server: { select: { ownerId: true } } },
    });
    if (!membership) throw new NotFoundException('Server nicht gefunden');
    if (membership.server.ownerId === userId) {
      throw new ForbiddenException(
        'Der Eigentümer kann den Server nicht verlassen – lösche ihn oder übertrage ihn (später)',
      );
    }
    await this.prisma.membership.delete({
      where: { userId_serverId: { userId, serverId } },
    });
    // Auch der Verlassende bekommt das Event (für andere offene Tabs).
    const recipients = [...(await this.memberIds(serverId)), userId];
    await this.gateway.publishDispatch('SERVER_MEMBER_REMOVE', { serverId, userId }, recipients);
  }

  async createChannel(
    serverId: string,
    userId: string,
    dto: CreateChannelDto,
  ): Promise<ChannelInfo> {
    await this.permissions.requirePermission(serverId, userId, Permissions.ManageChannels);
    const last = await this.prisma.channel.findFirst({
      where: { serverId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const channel = await this.prisma.channel.create({
      data: { serverId, name: dto.name, position: (last?.position ?? -1) + 1 },
    });
    const info = toChannelInfo(channel);
    await this.gateway.publishDispatch(
      'CHANNEL_CREATE',
      { channel: info },
      await this.memberIds(serverId),
    );
    return info;
  }

  async updateChannel(
    channelId: string,
    userId: string,
    dto: UpdateChannelDto,
  ): Promise<ChannelInfo> {
    const channel = await this.requireServerChannel(channelId);
    await this.permissions.requirePermission(channel.serverId!, userId, Permissions.ManageChannels);
    const updated = await this.prisma.channel.update({ where: { id: channelId }, data: dto });
    const info = toChannelInfo(updated);
    await this.gateway.publishDispatch(
      'CHANNEL_UPDATE',
      { channel: info },
      await this.memberIds(channel.serverId!),
    );
    return info;
  }

  async deleteChannel(channelId: string, userId: string): Promise<void> {
    const channel = await this.requireServerChannel(channelId);
    await this.permissions.requirePermission(channel.serverId!, userId, Permissions.ManageChannels);
    await this.prisma.channel.delete({ where: { id: channelId } });
    this.removeChannelBlobs([channelId]);
    await this.gateway.publishDispatch(
      'CHANNEL_DELETE',
      { serverId: channel.serverId, channelId },
      await this.memberIds(channel.serverId!),
    );
  }

  // --- Helfer ----------------------------------------------------------------

  /**
   * Anhang-Blobs gelöschter Kanäle aus MinIO entfernen (Phase 8). Best-effort
   * und bewusst nicht awaited: Die DB-Zeilen sind weg, ein Storage-Fehler soll
   * das Löschen nicht mehr scheitern lassen – er hinterlässt nur unlesbaren
   * Ciphertext, dessen Schlüssel mit den Nachrichten verschwunden sind.
   */
  private removeChannelBlobs(channelIds: string[]): void {
    for (const channelId of channelIds) {
      void this.storage.removeAllWithPrefix(`${channelId}/`).catch((err: unknown) => {
        this.logger.warn(`Blobs von Kanal ${channelId} nicht aufräumbar: ${String(err)}`);
      });
    }
  }

  private async requireServerChannel(channelId: string): Promise<Channel> {
    const channel = await this.prisma.channel.findUnique({ where: { id: channelId } });
    // DM-Kanäle (serverId null) werden ab Phase 7 separat verwaltet.
    if (!channel || !channel.serverId) throw new NotFoundException('Kanal nicht gefunden');
    return channel;
  }

  private async memberIds(serverId: string): Promise<string[]> {
    const members = await this.prisma.membership.findMany({
      where: { serverId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}

// --- Mapper: DB-Objekte → API-Typen (nie DB-Objekte direkt ausliefern) -------

function toServerSummary(server: Server): ServerSummary {
  return {
    id: server.id,
    name: server.name,
    ownerId: server.ownerId,
    iconUrl: server.iconUrl,
    createdAt: server.createdAt.toISOString(),
  };
}

function toChannelInfo(channel: Channel): ChannelInfo {
  return {
    id: channel.id,
    serverId: channel.serverId,
    type: channel.type,
    name: channel.name,
    position: channel.position,
    isPrivate: channel.isPrivate,
  };
}

function toServerMember(m: MembershipWithUser): ServerMember {
  return {
    userId: m.userId,
    username: m.user.username,
    nickname: m.nickname,
    joinedAt: m.joinedAt.toISOString(),
    roleIds: m.roles.map((r) => r.roleId),
  };
}
