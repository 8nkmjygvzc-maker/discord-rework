import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Prisma, VoiceSession } from '@prisma/client';
import { DmChannelInfo, PublicUser, VoiceState } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { VisibilityService } from '../gateway/visibility.service';
import { FriendsService, publicUserSelect, toPublicUser } from '../friends/friends.service';

/**
 * Direktnachrichten-Kanäle (Phase 7). Ein DM-Kanal ist ein Channel vom Typ DM
 * ohne Server, mit genau zwei DmMember-Zeilen. Der kanonische `dmKey`
 * ("kleinereId:größereId") verhindert per Unique-Constraint, dass beim
 * gleichzeitigen Öffnen von beiden Seiten zwei Kanäle entstehen.
 *
 * Policy (Arians Entscheidung, Discord-typisch): DMs zwischen Freunden ODER
 * Mitgliedern eines gemeinsamen Servers; Blockierung sperrt in beide Richtungen.
 */
@Injectable()
export class DmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly visibility: VisibilityService,
    private readonly friends: FriendsService,
  ) {}

  async open(userId: string, otherId: string): Promise<DmChannelInfo> {
    if (otherId === userId) throw new BadRequestException('Kein DM-Kanal mit dir selbst');
    const other = await this.prisma.user.findUnique({
      where: { id: otherId },
      select: publicUserSelect,
    });
    if (!other) throw new NotFoundException('Nutzer nicht gefunden');

    if (await this.friends.isBlockedBetween(userId, otherId)) {
      throw new ForbiddenException('Mit diesem Nutzer ist keine Direktnachricht möglich');
    }
    const allowed =
      (await this.friends.areFriends(userId, otherId)) ||
      (await this.visibility.sharesServer(userId, otherId));
    if (!allowed) {
      throw new ForbiddenException(
        'Direktnachrichten sind nur mit Freunden oder Mitgliedern gemeinsamer Server möglich',
      );
    }

    const dmKey = [userId, otherId].sort().join(':');
    const existing = await this.prisma.channel.findUnique({
      where: { dmKey },
      include: { voiceSessions: { include: { user: { select: { username: true } } } } },
    });
    if (existing) {
      return toDmChannelInfo(existing, toPublicUser(other), toVoiceStates(existing.voiceSessions));
    }

    let channel: Channel;
    try {
      channel = await this.prisma.channel.create({
        data: {
          type: 'DM',
          name: '',
          dmKey,
          dmMembers: { create: [{ userId }, { userId: otherId }] },
        },
      });
    } catch (err) {
      // Unique-Konflikt: Gegenseite hat den Kanal gerade parallel angelegt.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.channel.findUniqueOrThrow({ where: { dmKey } });
        return toDmChannelInfo(raced, toPublicUser(other), []);
      }
      throw err;
    }

    // Beide Seiten informieren – der Payload ist pro Empfänger unterschiedlich,
    // weil jeder den JEWEILS ANDEREN als Gesprächspartner sieht.
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: publicUserSelect,
    });
    await this.gateway.publishDispatch(
      'DM_CHANNEL_CREATE',
      { channel: toDmChannelInfo(channel, toPublicUser(other), []) },
      [userId],
    );
    await this.gateway.publishDispatch(
      'DM_CHANNEL_CREATE',
      { channel: toDmChannelInfo(channel, toPublicUser(me), []) },
      [otherId],
    );
    return toDmChannelInfo(channel, toPublicUser(other), []);
  }

  async listMine(userId: string): Promise<DmChannelInfo[]> {
    const memberships = await this.prisma.dmMember.findMany({
      where: { userId },
      include: {
        channel: {
          include: {
            dmMembers: { include: { user: { select: publicUserSelect } } },
            // Aktive private Anrufe (Roster-Snapshot wie ServerDetails.voiceStates).
            voiceSessions: { include: { user: { select: { username: true } } } },
          },
        },
      },
    });
    return memberships
      .map((m) => {
        const other = m.channel.dmMembers.find((x) => x.userId !== userId);
        // Defensiv: Kanal ohne Gegenseite (sollte nicht vorkommen) überspringen.
        return other
          ? toDmChannelInfo(
              m.channel,
              toPublicUser(other.user),
              toVoiceStates(m.channel.voiceSessions),
            )
          : null;
      })
      .filter((c): c is DmChannelInfo => c !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

function toDmChannelInfo(
  channel: Channel,
  otherUser: PublicUser,
  voiceStates: VoiceState[],
): DmChannelInfo {
  return { id: channel.id, otherUser, createdAt: channel.createdAt.toISOString(), voiceStates };
}

function toVoiceStates(sessions: (VoiceSession & { user: { username: string } })[]): VoiceState[] {
  return sessions.map((s) => ({
    channelId: s.channelId,
    userId: s.userId,
    username: s.user.username,
    muted: s.muted,
    deafened: s.deafened,
    cameraOn: s.cameraOn,
    screenOn: s.screenOn,
  }));
}
