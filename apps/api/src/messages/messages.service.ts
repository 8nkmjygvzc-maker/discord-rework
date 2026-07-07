import { BadRequestException, Injectable } from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import { EncryptedMessageHeader, MessageHistoryResponse, MessageInfo } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { ChannelAccessService } from './channel-access.service';
import { SendMessageDto } from './dto/send-message.dto';

/** Seitengröße der History – Client lädt ältere Nachrichten seitenweise nach. */
const PAGE_SIZE = 50;

/** Nur diese Anhangs-Felder verlassen den Server (kein objectKey, kein Uploader). */
const attachmentSelect = { select: { id: true, sizeBytes: true } } as const;

type MessageWithRelations = Message & {
  sender: { username: string };
  attachments: { id: string; sizeBytes: number }[];
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  async send(channelId: string, userId: string, dto: SendMessageDto): Promise<MessageInfo> {
    const recipients = await this.channelAccess.requireChannelAccess(channelId, userId, 'send');
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];

    // Seit Phase 6 erreicht den Server nur noch Ciphertext – gespeichert und
    // weitergereicht wird er unverändert, lesen kann ihn nur ein Mitglied mit
    // dem passenden Sender-Key.
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          channelId,
          senderId: userId,
          ciphertext: dto.ciphertext,
          nonce: dto.nonce,
          header: dto.header as unknown as Prisma.InputJsonValue,
        },
      });
      if (attachmentIds.length > 0) {
        // Anhänge atomar binden: nur eigene, noch unverbrauchte Uploads
        // DESSELBEN Kanals. Zählt das Update weniger Zeilen als erwartet,
        // rollt die Transaktion die Nachricht wieder zurück.
        const linked = await tx.attachment.updateMany({
          where: { id: { in: attachmentIds }, uploaderId: userId, channelId, messageId: null },
          data: { messageId: created.id },
        });
        if (linked.count !== attachmentIds.length) {
          throw new BadRequestException(
            'Mindestens ein Anhang ist unbekannt, gehört nicht dir oder wurde bereits verwendet',
          );
        }
      }
      return tx.message.findUniqueOrThrow({
        where: { id: created.id },
        include: { sender: { select: { username: true } }, attachments: attachmentSelect },
      });
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
    await this.channelAccess.requireChannelAccess(channelId, userId, 'read');

    const messages = await this.prisma.message.findMany({
      where: {
        channelId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      include: { sender: { select: { username: true } }, attachments: attachmentSelect },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE + 1, // eins mehr = zuverlässiges hasMore ohne COUNT
    });

    const hasMore = messages.length > PAGE_SIZE;
    const page = messages.slice(0, PAGE_SIZE).reverse();
    return { messages: page.map(toMessageInfo), hasMore };
  }
}

function toMessageInfo(message: MessageWithRelations): MessageInfo {
  return {
    id: message.id,
    channelId: message.channelId,
    senderId: message.senderId,
    senderUsername: message.sender.username,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    header: message.header as unknown as EncryptedMessageHeader,
    attachments: message.attachments.map((a) => ({ id: a.id, sizeBytes: a.sizeBytes })),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
  };
}
