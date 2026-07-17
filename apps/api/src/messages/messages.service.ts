import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Message, Prisma } from '@prisma/client';
import {
  EncryptedMessageHeader,
  MessageCreatePayload,
  MessageDeletePayload,
  MessageHistoryResponse,
  MessageInfo,
  Permissions,
  TypingStartPayload,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PushService } from '../push/push.service';
import { PermissionsService } from '../roles/permissions.service';
import { StorageService } from '../storage/storage.service';
import { ChannelAccessService } from './channel-access.service';
import { SendMessageDto } from './dto/send-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';

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
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly push: PushService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
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
    // Kanal-Kontext (Phase 15): Kanal- und Server-Name sind Server-Metadaten
    // (kein E2EE-Inhalt) – Clients können damit Erwähnungs-Benachrichtigungen
    // auch für Kanäle formulieren, deren Server gerade nicht ausgewählt ist.
    const channelMeta = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true, type: true, server: { select: { name: true } } },
    });
    const payload: MessageCreatePayload = {
      message: info,
      ...(channelMeta?.server
        ? { context: { channelName: channelMeta.name, serverName: channelMeta.server.name } }
        : {}),
    };
    await this.gateway.publishDispatch('MESSAGE_CREATE', payload, recipients);
    // Web-Push für DMs (Phase 12): den offline DM-Partner benachrichtigen.
    // Server-Kanäle laufen über den Erwähnungs-Hint (notifyMentions), weil der
    // Server Erwähnungen im Ciphertext nicht erkennen kann. Best-effort.
    if (channelMeta?.type === 'DM') {
      void this.pushDirectMessage(channelId, userId, message.sender.username, recipients).catch(
        () => undefined,
      );
    }
    return info;
  }

  /**
   * Nachricht bearbeiten (Phase 13) – nur der Autor. Die Zugriffsprüfung läuft
   * wie beim Senden (Rechte + Auszeit + DM-Blockierung); der Ciphertext wird
   * komplett ersetzt und `editedAt` gesetzt.
   */
  async editMessage(
    channelId: string,
    messageId: string,
    userId: string,
    dto: EditMessageDto,
  ): Promise<MessageInfo> {
    const recipients = await this.channelAccess.requireChannelAccess(channelId, userId, 'send');
    const existing = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!existing || existing.channelId !== channelId) {
      throw new NotFoundException('Nachricht nicht gefunden');
    }
    if (existing.senderId !== userId) {
      throw new ForbiddenException('Nur der Autor kann eine Nachricht bearbeiten');
    }
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        ciphertext: dto.ciphertext,
        nonce: dto.nonce,
        header: dto.header as unknown as Prisma.InputJsonValue,
        editedAt: new Date(),
      },
      include: { sender: { select: { username: true } }, attachments: attachmentSelect },
    });
    const info = toMessageInfo(message);
    await this.gateway.publishDispatch('MESSAGE_UPDATE', { message: info }, recipients);
    return info;
  }

  /**
   * Nachricht löschen (Phase 13). Der Autor darf seine eigene Nachricht löschen;
   * in Server-Kanälen darf zusätzlich jemand mit ManageMessages fremde löschen
   * (dann wird die Löschung ins Audit-Log geschrieben). Gebundene MinIO-Blobs
   * (Phase 8) werden mit entfernt – die DB-Cascade allein ließe sie verwaisen.
   */
  async deleteMessage(channelId: string, messageId: string, userId: string): Promise<void> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true, dmMembers: { select: { userId: true } } },
    });
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { attachments: { select: { objectKey: true } } },
    });
    if (!channel || !message || message.channelId !== channelId) {
      throw new NotFoundException('Nachricht nicht gefunden');
    }

    let recipients: string[];
    let byModerator = false;
    if (channel.type === 'TEXT' && channel.serverId) {
      // Mitglied sein (Lesen) – wirft 404 für Außenstehende, kein Existenz-Leak.
      await this.channelAccess.requireChannelAccess(channelId, userId, 'read');
      if (message.senderId !== userId) {
        await this.permissions.requirePermission(
          channel.serverId,
          userId,
          Permissions.ManageMessages,
        );
        byModerator = true;
      }
      recipients = await this.permissions.getMemberIdsWithPermission(
        channel.serverId,
        Permissions.ViewChannels,
      );
    } else if (channel.type === 'DM') {
      const memberIds = channel.dmMembers.map((m) => m.userId);
      if (!memberIds.includes(userId)) throw new NotFoundException('Nachricht nicht gefunden');
      if (message.senderId !== userId) {
        throw new ForbiddenException(
          'In Direktnachrichten kannst du nur eigene Nachrichten löschen',
        );
      }
      recipients = memberIds;
    } else {
      throw new NotFoundException('Nachricht nicht gefunden');
    }

    const objectKeys = message.attachments.map((a) => a.objectKey);
    // Cascade entfernt die Attachment-Zeilen mit; die Blobs danach best-effort.
    await this.prisma.message.delete({ where: { id: messageId } });
    this.removeBlobs(objectKeys);
    await this.gateway.publishDispatch(
      'MESSAGE_DELETE',
      { channelId, messageId } satisfies MessageDeletePayload,
      recipients,
    );

    if (byModerator && channel.serverId) {
      const sender = await this.prisma.user.findUnique({
        where: { id: message.senderId },
        select: { username: true },
      });
      await this.prisma.auditLogEntry.create({
        data: {
          serverId: channel.serverId,
          actorId: userId,
          action: 'MESSAGE_DELETE',
          targetUserId: message.senderId,
          targetUsername: sender?.username ?? null,
          reason: null,
        },
      });
    }
  }

  /** Anhang-Blobs gelöschter Nachrichten aus MinIO entfernen (best-effort). */
  private removeBlobs(objectKeys: string[]): void {
    for (const key of objectKeys) {
      void this.storage.removeObject(key).catch((err: unknown) => {
        this.logger.warn(`Blob ${key} nicht löschbar: ${String(err)}`);
      });
    }
  }

  /** Pusht bei einer DM-Nachricht den offline Partner (inhaltsarm). */
  private async pushDirectMessage(
    channelId: string,
    senderId: string,
    senderUsername: string,
    recipients: string[],
  ): Promise<void> {
    const targets = recipients.filter((r) => r !== senderId);
    await Promise.all(
      targets.map((userId) =>
        this.push.pushToUserIfOffline(userId, {
          title: senderUsername,
          body: 'Neue Direktnachricht',
          url: '/',
          tag: `dm:${channelId}`,
        }),
      ),
    );
  }

  /**
   * „X schreibt …“ (Verbesserungs-Runde): TYPING_START an alle zustellbaren
   * Kanal-Mitglieder außer dem Tippenden selbst. Kein DB-Schreibzugriff –
   * der Zustand lebt nur kurz in den Clients (Timeout blendet ihn aus).
   */
  async typing(channelId: string, userId: string, username: string): Promise<void> {
    const recipients = await this.channelAccess.requireChannelAccess(channelId, userId, 'send');
    const targets = recipients.filter((r) => r !== userId);
    if (targets.length === 0) return;
    // Wer als unsichtbar (INVISIBLE) unterwegs ist, erscheint für andere
    // offline – der Tipp-Indikator würde ihn sonst verraten.
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { presence: true },
    });
    if (sender?.presence === 'INVISIBLE') return;
    await this.gateway.publishDispatch(
      'TYPING_START',
      { channelId, userId, username } satisfies TypingStartPayload,
      targets,
    );
  }

  /**
   * Erwähnungs-Push (Phase 12): der sendende Client meldet die erwähnten
   * Mitglieder; der Server verifiziert die Sende-Berechtigung, filtert auf
   * echte Kanal-Mitglieder und pusht die offline unter ihnen. Der Server sieht
   * dabei keinen Nachrichtentext – nur wer erwähnt wurde (Metadaten).
   */
  async notifyMentions(
    channelId: string,
    senderId: string,
    senderUsername: string,
    userIds: string[],
  ): Promise<void> {
    // 'send' prüft die Sende-Berechtigung des Melders und liefert die
    // zustellbaren Mitglieder (ViewChannels) als erlaubte Ziel-Menge.
    const recipients = await this.channelAccess.requireChannelAccess(channelId, senderId, 'send');
    const allowed = new Set(recipients);
    const targets = [...new Set(userIds)].filter((u) => u !== senderId && allowed.has(u));
    if (targets.length === 0) return;
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { name: true },
    });
    await Promise.all(
      targets.map((userId) =>
        this.push.pushToUserIfOffline(userId, {
          title: senderUsername,
          body: `hat dich in #${channel?.name ?? 'einem Kanal'} erwähnt`,
          url: '/',
          tag: `mention:${channelId}`,
        }),
      ),
    );
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
