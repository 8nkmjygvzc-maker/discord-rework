import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import {
  EncryptedMessageHeader,
  MessageHistoryResponse,
  MessageInfo,
  Permissions,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { FriendsService } from '../friends/friends.service';
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
    private readonly friends: FriendsService,
  ) {}

  async send(channelId: string, userId: string, dto: SendMessageDto): Promise<MessageInfo> {
    const recipients = await this.requireChannelAccess(channelId, userId, 'send');
    // Seit Phase 6 erreicht den Server nur noch Ciphertext – gespeichert und
    // weitergereicht wird er unverändert, lesen kann ihn nur ein Mitglied mit
    // dem passenden Sender-Key.
    const message = await this.prisma.message.create({
      data: {
        channelId,
        senderId: userId,
        ciphertext: dto.ciphertext,
        nonce: dto.nonce,
        header: dto.header as unknown as Prisma.InputJsonValue,
      },
      include: { sender: { select: { username: true } } },
    });
    const info = toMessageInfo(message);
    await this.gateway.publishDispatch('MESSAGE_CREATE', { message: info }, recipients);
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
    await this.requireChannelAccess(channelId, userId, 'read');

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
   * Zugriffsprüfung für Server-Textkanäle UND DM-Kanäle (Phase 7).
   * 404 für Außenstehende (kein Existenz-Leak), 403 bei fehlendem Recht bzw.
   * Blockierung. Liefert beim Senden die Event-Empfänger, sonst [].
   *
   *  - Server-Kanal: Rechte-Modell aus Phase 5 (SendMessages/ViewChannels);
   *    Empfänger sind nur Mitglieder mit ViewChannels – sonst würde die
   *    REST-History zwar sperren, das Gateway aber trotzdem live zustellen.
   *  - DM-Kanal: nur die zwei Teilnehmer; eine Blockierung (egal von wem)
   *    sperrt das SENDEN in beide Richtungen, die History bleibt lesbar.
   */
  private async requireChannelAccess(
    channelId: string,
    userId: string,
    intent: 'read' | 'send',
  ): Promise<string[]> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true, dmMembers: { select: { userId: true } } },
    });

    if (channel?.type === 'TEXT' && channel.serverId) {
      await this.permissions.requirePermission(
        channel.serverId,
        userId,
        intent === 'send' ? Permissions.SendMessages : Permissions.ViewChannels,
      );
      return intent === 'send'
        ? this.permissions.getMemberIdsWithPermission(channel.serverId, Permissions.ViewChannels)
        : [];
    }

    if (channel?.type === 'DM') {
      const memberIds = channel.dmMembers.map((m) => m.userId);
      if (!memberIds.includes(userId)) throw new NotFoundException('Kanal nicht gefunden');
      if (intent === 'send' && memberIds.length === 2) {
        const [a, b] = memberIds;
        if (await this.friends.isBlockedBetween(a, b)) {
          throw new ForbiddenException('Direktnachrichten mit diesem Nutzer sind blockiert');
        }
      }
      return memberIds;
    }

    throw new NotFoundException('Kanal nicht gefunden');
  }
}

function toMessageInfo(message: MessageWithSender): MessageInfo {
  return {
    id: message.id,
    channelId: message.channelId,
    senderId: message.senderId,
    senderUsername: message.sender.username,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    header: message.header as unknown as EncryptedMessageHeader,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
  };
}
