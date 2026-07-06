import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Sichtbarkeitskreis eines Nutzers (Phase 7): angenommene Freunde,
 * Mitglieder gemeinsamer Server und DM-Gesprächspartner. Alle drei
 * Beziehungen sind symmetrisch – wer A sieht, wird auch von A gesehen.
 *
 * Wird für das Presence-Routing (statt globalem Broadcast) und für die
 * Empfänger-Beschränkung der Schlüssel-Umschläge genutzt. Blockierungen
 * spielen hier bewusst KEINE Rolle: Blockierte Co-Mitglieder brauchen
 * weiterhin Sender-Keys für gemeinsame Kanäle.
 */
@Injectable()
export class VisibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** IDs aller Nutzer im Sichtbarkeitskreis (ohne den Nutzer selbst). */
  async getVisibleUserIds(userId: string): Promise<string[]> {
    const [friendships, memberships, dmChannels] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { status: 'ACCEPTED', OR: [{ userId }, { friendId: userId }] },
        select: { userId: true, friendId: true },
      }),
      this.prisma.membership.findMany({ where: { userId }, select: { serverId: true } }),
      this.prisma.dmMember.findMany({ where: { userId }, select: { channelId: true } }),
    ]);

    const ids = new Set<string>();
    for (const f of friendships) ids.add(f.userId === userId ? f.friendId : f.userId);

    if (memberships.length > 0) {
      const coMembers = await this.prisma.membership.findMany({
        where: { serverId: { in: memberships.map((m) => m.serverId) } },
        select: { userId: true },
        distinct: ['userId'],
      });
      for (const m of coMembers) ids.add(m.userId);
    }
    if (dmChannels.length > 0) {
      const partners = await this.prisma.dmMember.findMany({
        where: { channelId: { in: dmChannels.map((c) => c.channelId) } },
        select: { userId: true },
        distinct: ['userId'],
      });
      for (const p of partners) ids.add(p.userId);
    }

    ids.delete(userId);
    return [...ids];
  }

  /** Sieht `viewerId` den Nutzer `targetId`? (Symmetrisch.) */
  async canSee(viewerId: string, targetId: string): Promise<boolean> {
    if (viewerId === targetId) return true;
    const [friendship, sharedServer, sharedDm] = await Promise.all([
      this.prisma.friendship.findFirst({
        where: {
          status: 'ACCEPTED',
          OR: [
            { userId: viewerId, friendId: targetId },
            { userId: targetId, friendId: viewerId },
          ],
        },
        select: { id: true },
      }),
      this.prisma.membership.findFirst({
        where: { userId: viewerId, server: { members: { some: { userId: targetId } } } },
        select: { serverId: true },
      }),
      this.prisma.dmMember.findFirst({
        where: { userId: viewerId, channel: { dmMembers: { some: { userId: targetId } } } },
        select: { channelId: true },
      }),
    ]);
    return Boolean(friendship ?? sharedServer ?? sharedDm);
  }

  /** Teilen sich zwei Nutzer mindestens einen Server? */
  async sharesServer(a: string, b: string): Promise<boolean> {
    const shared = await this.prisma.membership.findFirst({
      where: { userId: a, server: { members: { some: { userId: b } } } },
      select: { serverId: true },
    });
    return shared !== null;
  }
}
