import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Friendship, User } from '@prisma/client';
import { FriendRequestInfo, FriendsList, PublicUser } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PresenceService } from '../gateway/presence.service';

/** Nur öffentliche Felder – nie ganze User-Objekte ausliefern. */
export const publicUserSelect = {
  id: true,
  username: true,
  avatarUrl: true,
  bannerUrl: true,
  status: true,
} as const;

type PublicUserRow = Pick<User, 'id' | 'username' | 'avatarUrl' | 'bannerUrl' | 'status'>;

export function toPublicUser(user: PublicUserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    status: user.status,
  };
}

type FriendshipWithUsers = Friendship & { user: PublicUserRow; friend: PublicUserRow };

/**
 * Freundesystem (Phase 7). Zustandsmodell siehe schema.prisma: eine Zeile pro
 * Richtung, `userId` ist der Initiator des aktuellen Zustands. Jede Änderung
 * löst ein FRIENDS_UPDATE an beide Beteiligten aus – die Clients laden ihre
 * Liste dann neu (bewusst simpel statt granularer Patch-Events).
 */
@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly presence: PresenceService,
  ) {}

  async list(userId: string): Promise<FriendsList> {
    const rows = (await this.prisma.friendship.findMany({
      where: { OR: [{ userId }, { friendId: userId }] },
      include: { user: { select: publicUserSelect }, friend: { select: publicUserSelect } },
      orderBy: { createdAt: 'asc' },
    })) as FriendshipWithUsers[];

    const other = (row: FriendshipWithUsers): PublicUserRow =>
      row.userId === userId ? row.friend : row.user;
    const toRequest = (row: FriendshipWithUsers): FriendRequestInfo => ({
      user: toPublicUser(other(row)),
      createdAt: row.createdAt.toISOString(),
    });

    return {
      friends: rows.filter((r) => r.status === 'ACCEPTED').map((r) => toPublicUser(other(r))),
      incoming: rows.filter((r) => r.status === 'PENDING' && r.friendId === userId).map(toRequest),
      outgoing: rows.filter((r) => r.status === 'PENDING' && r.userId === userId).map(toRequest),
      // Nur MEINE Blockierungen – wer mich blockiert, bleibt unsichtbar.
      blocked: rows
        .filter((r) => r.status === 'BLOCKED' && r.userId === userId)
        .map((r) => toPublicUser(r.friend)),
    };
  }

  /** Anfrage per Benutzername; eine Gegen-Anfrage wird direkt angenommen. */
  async addByUsername(userId: string, username: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { username },
      select: publicUserSelect,
    });
    if (!target) throw new NotFoundException('Nutzer nicht gefunden');
    if (target.id === userId) {
      throw new BadRequestException('Du kannst dich nicht selbst hinzufügen');
    }

    const existing = await this.between(userId, target.id);
    // Blockierung in IRGENDEINER Richtung → generische Ablehnung, ohne zu
    // verraten, wer wen blockiert hat.
    if (existing.some((r) => r.status === 'BLOCKED')) {
      throw new BadRequestException('Freundschaftsanfrage nicht möglich');
    }
    if (existing.some((r) => r.status === 'ACCEPTED')) {
      throw new ConflictException('Ihr seid bereits Freunde');
    }
    if (existing.some((r) => r.status === 'PENDING' && r.userId === userId)) {
      throw new ConflictException('Anfrage bereits gesendet');
    }

    const reverse = existing.find((r) => r.status === 'PENDING' && r.friendId === userId);
    if (reverse) {
      // Beide wollen dasselbe → direkt annehmen.
      await this.prisma.friendship.update({
        where: { id: reverse.id },
        data: { status: 'ACCEPTED' },
      });
      await this.pushPresenceToEachOther(userId, target.id);
    } else {
      await this.prisma.friendship.create({ data: { userId, friendId: target.id } });
    }
    await this.notifyBoth(userId, target.id);
  }

  /** Offene Anfrage VON `requesterId` AN mich annehmen. */
  async accept(userId: string, requesterId: string): Promise<void> {
    const row = await this.prisma.friendship.findUnique({
      where: { userId_friendId: { userId: requesterId, friendId: userId } },
    });
    if (!row || row.status !== 'PENDING') {
      throw new NotFoundException('Keine offene Anfrage von diesem Nutzer');
    }
    await this.prisma.$transaction([
      this.prisma.friendship.update({ where: { id: row.id }, data: { status: 'ACCEPTED' } }),
      // Haben beide gleichzeitig angefragt (Race in addByUsername), existiert
      // auch eine Gegen-Anfrage von mir – die wäre sonst für immer PENDING.
      this.prisma.friendship.deleteMany({
        where: { userId, friendId: requesterId, status: 'PENDING' },
      }),
    ]);
    await this.notifyBoth(userId, requesterId);
    // Frisch befreundet → beide dürfen jetzt den Online-Status des anderen sehen.
    await this.pushPresenceToEachOther(userId, requesterId);
  }

  /** Ablehnen, Zurückziehen oder Entfreunden – je nachdem, was existiert. */
  async remove(userId: string, otherId: string): Promise<void> {
    const result = await this.prisma.friendship.deleteMany({
      where: {
        status: { in: ['PENDING', 'ACCEPTED'] },
        OR: [
          { userId, friendId: otherId },
          { userId: otherId, friendId: userId },
        ],
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('Keine Freundschaft oder Anfrage mit diesem Nutzer');
    }
    await this.notifyBoth(userId, otherId);
  }

  /** Blockieren ersetzt jede bestehende Beziehung (Anfrage/Freundschaft). */
  async block(userId: string, targetId: string): Promise<void> {
    if (targetId === userId)
      throw new BadRequestException('Du kannst dich nicht selbst blockieren');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('Nutzer nicht gefunden');

    await this.prisma.$transaction([
      this.prisma.friendship.deleteMany({
        where: {
          status: { in: ['PENDING', 'ACCEPTED'] },
          OR: [
            { userId, friendId: targetId },
            { userId: targetId, friendId: userId },
          ],
        },
      }),
      this.prisma.friendship.upsert({
        where: { userId_friendId: { userId, friendId: targetId } },
        create: { userId, friendId: targetId, status: 'BLOCKED' },
        update: { status: 'BLOCKED' },
      }),
    ]);
    // Die Gegenseite sieht nur, dass die Freundschaft/Anfrage weg ist.
    await this.notifyBoth(userId, targetId);
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    const result = await this.prisma.friendship.deleteMany({
      where: { userId, friendId: targetId, status: 'BLOCKED' },
    });
    if (result.count === 0) throw new NotFoundException('Nutzer ist nicht blockiert');
    await this.gateway.publishDispatch('FRIENDS_UPDATE', {}, [userId]);
  }

  // --- Abfragen für andere Module (DMs, Nachrichten) --------------------------

  /** Angenommene Freundschaft in irgendeiner Richtung? */
  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friendship.findFirst({
      where: {
        status: 'ACCEPTED',
        OR: [
          { userId: a, friendId: b },
          { userId: b, friendId: a },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  }

  /** Blockierung in irgendeiner Richtung? (Sperrt DMs in beide Richtungen.) */
  async isBlockedBetween(a: string, b: string): Promise<boolean> {
    const row = await this.prisma.friendship.findFirst({
      where: {
        status: 'BLOCKED',
        OR: [
          { userId: a, friendId: b },
          { userId: b, friendId: a },
        ],
      },
      select: { id: true },
    });
    return row !== null;
  }

  // --- Helfer ------------------------------------------------------------------

  /** Beide möglichen Zeilen zwischen zwei Nutzern. */
  private between(a: string, b: string): Promise<Friendship[]> {
    return this.prisma.friendship.findMany({
      where: {
        OR: [
          { userId: a, friendId: b },
          { userId: b, friendId: a },
        ],
      },
    });
  }

  private notifyBoth(a: string, b: string): Promise<void> {
    return this.gateway.publishDispatch('FRIENDS_UPDATE', {}, [a, b]);
  }

  /**
   * Nach einer neuen Freundschaft kennt keiner den Online-Status des anderen
   * (Presence ist gescoped, READY-Snapshot ist vorbei) → einmalig nachliefern.
   */
  private async pushPresenceToEachOther(a: string, b: string): Promise<void> {
    const online = await this.presence.filterOnline([a, b]);
    const userA = online.find((u) => u.id === a);
    const userB = online.find((u) => u.id === b);
    if (userA)
      await this.gateway.publishDispatch('PRESENCE_UPDATE', { user: userA, online: true }, [b]);
    if (userB)
      await this.gateway.publishDispatch('PRESENCE_UPDATE', { user: userB, online: true }, [a]);
  }
}
