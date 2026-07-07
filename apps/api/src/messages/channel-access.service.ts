import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Permissions } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../roles/permissions.service';
import { FriendsService } from '../friends/friends.service';

/**
 * Zugriffsprüfung für Server-Textkanäle UND DM-Kanäle – genutzt von
 * Nachrichten (Phase 4–7) und Anhängen (Phase 8).
 * 404 für Außenstehende (kein Existenz-Leak), 403 bei fehlendem Recht bzw.
 * Blockierung. Liefert bei intent 'send' die Event-Empfänger, sonst [] –
 * 'upload' prüft dieselben Rechte wie 'send', spart sich aber die (bei großen
 * Servern teure) Empfängerliste, die ein Upload nicht braucht.
 *
 *  - Server-Kanal: Rechte-Modell aus Phase 5 (SendMessages/ViewChannels);
 *    Empfänger sind nur Mitglieder mit ViewChannels – sonst würde die
 *    REST-History zwar sperren, das Gateway aber trotzdem live zustellen.
 *  - DM-Kanal: nur die zwei Teilnehmer; eine Blockierung (egal von wem)
 *    sperrt SENDEN und UPLOAD in beide Richtungen, die History bleibt lesbar.
 */
@Injectable()
export class ChannelAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly friends: FriendsService,
  ) {}

  async requireChannelAccess(
    channelId: string,
    userId: string,
    intent: 'read' | 'send' | 'upload',
  ): Promise<string[]> {
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true, type: true, dmMembers: { select: { userId: true } } },
    });

    if (channel?.type === 'TEXT' && channel.serverId) {
      await this.permissions.requirePermission(
        channel.serverId,
        userId,
        intent === 'read' ? Permissions.ViewChannels : Permissions.SendMessages,
      );
      return intent === 'send'
        ? this.permissions.getMemberIdsWithPermission(channel.serverId, Permissions.ViewChannels)
        : [];
    }

    if (channel?.type === 'DM') {
      const memberIds = channel.dmMembers.map((m) => m.userId);
      if (!memberIds.includes(userId)) throw new NotFoundException('Kanal nicht gefunden');
      if (intent !== 'read' && memberIds.length === 2) {
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
