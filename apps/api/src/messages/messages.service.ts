import { Injectable, NotFoundException } from '@nestjs/common';
import { Message } from '@prisma/client';
import { MessageHistoryResponse, MessageInfo, Permissions } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { SendMessageDto } from './dto/send-message.dto';

/** Seitengröße der History – Client lädt ältere Nachrichten seitenweise nach. */
const PAGE_SIZE = 50;

type MessageWithSender = Message & { sender: { username: string } };

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
  ) {}

  async send(channelId: string, userId: string, dto: SendMessageDto): Promise<MessageInfo> {
    const serverId = await this.requireTextChannelAccess(
      channelId,
      userId,
      Permissions.SendMessages,
    );
    const message = await this.prisma.message.create({
      data: { channelId, senderId: userId, content: dto.content },
      include: { sender: { select: { username: true } } },
    });
    const info = toMessageInfo(message);

    const members = await this.prisma.membership.findMany({
      where: { serverId },
      select: { userId: true },
    });
    await this.gateway.publishDispatch(
      'MESSAGE_CREATE',
      { message: info },
      members.map((m) => m.userId),
    );
    return info;
  }

  /**
   * History rückwärts: die neuesten PAGE_SIZE Nachrichten vor `before`
   * (bzw. die allerneuesten ohne `before`), ausgeliefert älteste-zuerst.
   */
  async history(
    channelId: string,
    userId: string,
    before?: string,
  ): Promise<MessageHistoryResponse> {
    await this.requireTextChannelAccess(channelId, userId, Permissions.ViewChannels);

    const messages = await this.prisma.message.findMany({
      where: {
        channelId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: { sender: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1, // eins mehr = zuverlässiges hasMore ohne COUNT
    });

    const hasMore = messages.length > PAGE_SIZE;
    const page = messages.slice(0, PAGE_SIZE).reverse();
    return { messages: page.map(toMessageInfo), hasMore };
  }

  /**
   * Kanal muss existieren, ein Server-Textkanal sein und der Nutzer das
   * geforderte Recht haben. 404 für Nicht-Mitglieder (kein Existenz-Leak),
   * 403 bei fehlendem Recht. Liefert die serverId.
   */
  private async requireTextChannelAccess(
    channelId: string,
    userId: string,
    required: bigint,
  ): Promise<string> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true },
    });
    if (!channel?.serverId || channel.type !== 'TEXT') {
      throw new NotFoundException('Kanal nicht gefunden');
    }
    await this.permissions.requirePermission(channel.serverId, userId, required);
    return channel.serverId;
  }
}

function toMessageInfo(message: MessageWithSender): MessageInfo {
  return {
    id: message.id,
    channelId: message.channelId,
    senderId: message.senderId,
    senderUsername: message.sender.username,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
  };
}
