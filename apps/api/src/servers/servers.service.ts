import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Membership, Server, User } from '@prisma/client';
import type { ChannelInfo, ServerDetails, ServerMember, ServerSummary } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

type MembershipWithUser = Membership & { user: Pick<User, 'username'> };

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
  ) {}

  /** Legt Server + Owner-Mitgliedschaft + Standardkanal in einer Transaktion an. */
  async createServer(userId: string, dto: CreateServerDto): Promise<ServerDetails> {
    const server = await this.prisma.server.create({
      data: {
        name: dto.name,
        ownerId: userId,
        members: { create: { userId } },
        channels: { create: { name: 'allgemein', position: 0 } },
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

  /** Vollansicht inkl. Kanälen und Mitgliedern – nur für Mitglieder. */
  async getServerDetails(serverId: string, userId: string): Promise<ServerDetails> {
    const server = await this.requireMembership(serverId, userId);
    const [channels, members] = await Promise.all([
      this.prisma.channel.findMany({
        where: { serverId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.membership.findMany({
        where: { serverId },
        include: { user: { select: { username: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);
    return {
      ...toServerSummary(server),
      channels: channels.map(toChannelInfo),
      members: members.map(toServerMember),
    };
  }

  async updateServer(
    serverId: string,
    userId: string,
    dto: UpdateServerDto,
  ): Promise<ServerSummary> {
    await this.requireOwner(serverId, userId);
    const server = await this.prisma.server.update({ where: { id: serverId }, data: dto });
    const summary = toServerSummary(server);
    await this.gateway.publishDispatch(
      'SERVER_UPDATE',
      { server: summary },
      await this.memberIds(serverId),
    );
    return summary;
  }

  async deleteServer(serverId: string, userId: string): Promise<void> {
    await this.requireOwner(serverId, userId);
    // Empfänger VOR dem Löschen einsammeln – danach gibt es keine Mitglieder mehr.
    const memberIds = await this.memberIds(serverId);
    await this.prisma.server.delete({ where: { id: serverId } });
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
      include: { user: { select: { username: true } } },
    });
    await this.gateway.publishDispatch(
      'SERVER_MEMBER_ADD',
      { serverId, member: toServerMember(membership) },
      await this.memberIds(serverId),
    );
    return this.getServerDetails(serverId, userId);
  }

  async leave(serverId: string, userId: string): Promise<void> {
    const server = await this.requireMembership(serverId, userId);
    if (server.ownerId === userId) {
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
    await this.requireOwner(serverId, userId);
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
    await this.requireOwner(channel.serverId!, userId);
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
    await this.requireOwner(channel.serverId!, userId);
    await this.prisma.channel.delete({ where: { id: channelId } });
    await this.gateway.publishDispatch(
      'CHANNEL_DELETE',
      { serverId: channel.serverId, channelId },
      await this.memberIds(channel.serverId!),
    );
  }

  // --- Zugriffs-Helfer -------------------------------------------------------

  /**
   * Bewusst dieselbe 404 für „Server existiert nicht“ und „kein Mitglied“:
   * Nicht-Mitglieder sollen nicht erraten können, welche Server-IDs existieren.
   */
  private async requireMembership(serverId: string, userId: string): Promise<Server> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId, serverId } },
      include: { server: true },
    });
    if (!membership) throw new NotFoundException('Server nicht gefunden');
    return membership.server;
  }

  /** Verwaltungsaktionen sind bis Phase 5 (Rollen) dem Owner vorbehalten. */
  private async requireOwner(serverId: string, userId: string): Promise<Server> {
    const server = await this.requireMembership(serverId, userId);
    if (server.ownerId !== userId) {
      throw new ForbiddenException('Nur der Server-Eigentümer darf das');
    }
    return server;
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
  };
}
