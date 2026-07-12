import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership, User } from '@prisma/client';
import {
  AuditAction,
  AuditLogEntryInfo,
  BanInfo,
  Permissions,
  ServerMemberRemovePayload,
  ServerSelfRemovedPayload,
} from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { PermissionsService } from '../roles/permissions.service';
import { VoiceService } from '../voice/voice.service';
import { MEMBER_USER_SELECT, toServerMember } from '../servers/servers.service';

/** Wie viele Audit-Log-Einträge eine Abfrage höchstens liefert. */
const AUDIT_LOG_LIMIT = 100;

type MemberWithUser = Membership & {
  user: Pick<User, 'username' | 'avatarUrl' | 'status'>;
  roles: { roleId: string }[];
};

/**
 * Moderationswerkzeuge (Phase 13): Kick, Bann/Entbannen, Timeout, Voice-Trennen
 * und das Audit-Log. Alle Aktionen sind serverseitig durch Rechte (Phase 5) UND
 * eine Rollen-Hierarchie abgesichert: Man darf nur Mitglieder mit strikt
 * niedrigerem Rang moderieren, nie den Owner, nie sich selbst.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: GatewayService,
    private readonly permissions: PermissionsService,
    private readonly voice: VoiceService,
  ) {}

  /** Entfernt ein Mitglied; es kann per Einladung zurückkehren. */
  async kick(
    serverId: string,
    actorId: string,
    targetUserId: string,
    reason?: string,
  ): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.KickMembers);
    const target = await this.assertCanModerate(serverId, actorId, targetUserId);
    await this.voice.forceDisconnect(targetUserId, serverId);
    await this.prisma.membership.delete({
      where: { userId_serverId: { userId: targetUserId, serverId } },
    });
    await this.broadcastRemoval(serverId, targetUserId);
    await this.notifySelfRemoved(serverId, targetUserId, 'kick', reason);
    await this.writeAudit(
      serverId,
      actorId,
      'MEMBER_KICK',
      targetUserId,
      target.user.username,
      reason,
    );
  }

  /** Bannt ein Mitglied (entfernt es und sperrt den Wiedereintritt). */
  async ban(
    serverId: string,
    actorId: string,
    targetUserId: string,
    reason?: string,
  ): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.BanMembers);
    const target = await this.assertCanModerate(serverId, actorId, targetUserId);
    await this.voice.forceDisconnect(targetUserId, serverId);
    // Bann-Zeile anlegen UND Mitgliedschaft entfernen – atomar.
    await this.prisma.$transaction([
      this.prisma.ban.upsert({
        where: { serverId_userId: { serverId, userId: targetUserId } },
        create: { serverId, userId: targetUserId, bannedById: actorId, reason: reason ?? null },
        update: { bannedById: actorId, reason: reason ?? null },
      }),
      this.prisma.membership.delete({
        where: { userId_serverId: { userId: targetUserId, serverId } },
      }),
    ]);
    await this.broadcastRemoval(serverId, targetUserId);
    await this.notifySelfRemoved(serverId, targetUserId, 'ban', reason);
    await this.writeAudit(
      serverId,
      actorId,
      'MEMBER_BAN',
      targetUserId,
      target.user.username,
      reason,
    );
  }

  /** Hebt einen Bann auf (der Nutzer ist kein Mitglied, daher keine Hierarchie-Prüfung). */
  async unban(serverId: string, actorId: string, targetUserId: string): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.BanMembers);
    const ban = await this.prisma.ban.findUnique({
      where: { serverId_userId: { serverId, userId: targetUserId } },
      include: { user: { select: { username: true } } },
    });
    if (!ban) throw new NotFoundException('Dieser Nutzer ist nicht gebannt');
    await this.prisma.ban.delete({
      where: { serverId_userId: { serverId, userId: targetUserId } },
    });
    await this.writeAudit(serverId, actorId, 'MEMBER_UNBAN', targetUserId, ban.user.username, null);
  }

  /** Liste der aktiven Bannungen (Recht: BanMembers). */
  async listBans(serverId: string, actorId: string): Promise<BanInfo[]> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.BanMembers);
    const bans = await this.prisma.ban.findMany({
      where: { serverId },
      include: { user: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Namen der Bannenden gesammelt auflösen (bannedById hat keine Relation).
    const bannerIds = [...new Set(bans.map((b) => b.bannedById))];
    const banners = await this.prisma.user.findMany({
      where: { id: { in: bannerIds } },
      select: { id: true, username: true },
    });
    const bannerName = new Map(banners.map((u) => [u.id, u.username]));
    return bans.map((b) => ({
      userId: b.userId,
      username: b.user.username,
      bannedById: b.bannedById,
      bannedByUsername: bannerName.get(b.bannedById) ?? 'Unbekannt',
      reason: b.reason,
      createdAt: b.createdAt.toISOString(),
    }));
  }

  /** Schickt ein Mitglied für `durationSeconds` in Auszeit (Timeout). */
  async timeout(
    serverId: string,
    actorId: string,
    targetUserId: string,
    durationSeconds: number,
    reason?: string,
  ): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.ModerateMembers);
    const target = await this.assertCanModerate(serverId, actorId, targetUserId);
    const until = new Date(Date.now() + durationSeconds * 1000);
    const updated = await this.prisma.membership.update({
      where: { userId_serverId: { userId: targetUserId, serverId } },
      data: { timeoutUntil: until },
      include: { user: { select: MEMBER_USER_SELECT }, roles: { select: { roleId: true } } },
    });
    // Auszeit trennt auch aus dem Voice (kann nicht mehr sprechen).
    await this.voice.forceDisconnect(targetUserId, serverId);
    await this.broadcastMemberUpdate(serverId, updated);
    await this.writeAudit(
      serverId,
      actorId,
      'MEMBER_TIMEOUT',
      targetUserId,
      target.user.username,
      reason,
    );
  }

  /** Hebt eine Auszeit vorzeitig auf. */
  async removeTimeout(serverId: string, actorId: string, targetUserId: string): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.ModerateMembers);
    const target = await this.assertCanModerate(serverId, actorId, targetUserId);
    if (target.timeoutUntil === null) return; // schon frei – nichts zu tun
    const updated = await this.prisma.membership.update({
      where: { userId_serverId: { userId: targetUserId, serverId } },
      data: { timeoutUntil: null },
      include: { user: { select: MEMBER_USER_SELECT }, roles: { select: { roleId: true } } },
    });
    await this.broadcastMemberUpdate(serverId, updated);
    await this.writeAudit(
      serverId,
      actorId,
      'MEMBER_TIMEOUT_REMOVE',
      targetUserId,
      target.user.username,
      null,
    );
  }

  /** Trennt ein Mitglied aus dem Sprachkanal (Voice-Moderation). */
  async disconnectVoice(serverId: string, actorId: string, targetUserId: string): Promise<void> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.ModerateMembers);
    const target = await this.assertCanModerate(serverId, actorId, targetUserId);
    const disconnected = await this.voice.forceDisconnect(targetUserId, serverId);
    if (!disconnected) {
      throw new NotFoundException('Das Mitglied ist in keinem Sprachkanal dieses Servers');
    }
    await this.writeAudit(
      serverId,
      actorId,
      'VOICE_DISCONNECT',
      targetUserId,
      target.user.username,
      null,
    );
  }

  /** Audit-Log (Recht: ViewAuditLog), neueste zuerst. */
  async getAuditLog(serverId: string, actorId: string): Promise<AuditLogEntryInfo[]> {
    await this.permissions.requirePermission(serverId, actorId, Permissions.ViewAuditLog);
    const entries = await this.prisma.auditLogEntry.findMany({
      where: { serverId },
      include: { actor: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      take: AUDIT_LOG_LIMIT,
    });
    return entries.map((e) => ({
      id: e.id,
      action: e.action as AuditAction,
      actorId: e.actorId,
      actorUsername: e.actor.username,
      targetUserId: e.targetUserId,
      targetUsername: e.targetUsername,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  // --- Helfer ----------------------------------------------------------------

  /**
   * Prüft die Moderations-Hierarchie und liefert das Zielmitglied zurück.
   * Wirft 400 (Selbstziel), 404 (kein Mitglied) oder 403 (Owner bzw. gleicher/
   * höherer Rang). Der Aufrufer hat das jeweilige Rechte-Bit bereits geprüft.
   */
  private async assertCanModerate(
    serverId: string,
    actorId: string,
    targetUserId: string,
  ): Promise<MemberWithUser> {
    if (targetUserId === actorId) {
      throw new BadRequestException('Du kannst dich nicht selbst moderieren');
    }
    const target = await this.prisma.membership.findUnique({
      where: { userId_serverId: { userId: targetUserId, serverId } },
      include: { user: { select: MEMBER_USER_SELECT }, roles: { select: { roleId: true } } },
    });
    if (!target) throw new NotFoundException('Mitglied nicht gefunden');

    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { ownerId: true },
    });
    if (server?.ownerId === targetUserId) {
      throw new ForbiddenException('Der Server-Eigentümer kann nicht moderiert werden');
    }

    const [actorRank, targetRank] = await Promise.all([
      this.permissions.getMemberRank(serverId, actorId),
      this.permissions.getMemberRank(serverId, targetUserId),
    ]);
    // actorRank ist nach der Rechteprüfung nie null; targetRank ist nach dem
    // Mitglieds-Check nie null – die Guards sind reine Absicherung.
    if (actorRank === null || targetRank === null || actorRank <= targetRank) {
      throw new ForbiddenException(
        'Du kannst dieses Mitglied nicht moderieren (gleiche oder höhere Rolle)',
      );
    }
    return target;
  }

  /** Entfernungs-Event an alle Server-Mitglieder UND das entfernte Mitglied. */
  private async broadcastRemoval(serverId: string, userId: string): Promise<void> {
    const recipients = [...(await this.memberIds(serverId)), userId];
    await this.gateway.publishDispatch(
      'SERVER_MEMBER_REMOVE',
      { serverId, userId } satisfies ServerMemberRemovePayload,
      recipients,
    );
  }

  /**
   * Rückmeldung NUR an den Gekickten/Gebannten (Phase 15): Anlass und Grund
   * gehen die übrigen Mitglieder nichts an, darum nicht Teil des
   * SERVER_MEMBER_REMOVE-Broadcasts. Der Servername reist mit, weil der
   * Client den Server zu diesem Zeitpunkt schon vergessen hat.
   */
  private async notifySelfRemoved(
    serverId: string,
    userId: string,
    cause: 'kick' | 'ban',
    reason?: string,
  ): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { name: true },
    });
    await this.gateway.publishDispatch(
      'SERVER_SELF_REMOVED',
      {
        serverId,
        serverName: server?.name ?? 'Unbekannter Server',
        cause,
        reason: reason ?? null,
      } satisfies ServerSelfRemovedPayload,
      [userId],
    );
  }

  /** Aktualisiertes Mitglied (z. B. Timeout) an alle Server-Mitglieder. */
  private async broadcastMemberUpdate(serverId: string, membership: MemberWithUser): Promise<void> {
    await this.gateway.publishDispatch(
      'SERVER_MEMBER_UPDATE',
      { serverId, member: toServerMember(membership) },
      await this.memberIds(serverId),
    );
  }

  private async writeAudit(
    serverId: string,
    actorId: string,
    action: AuditAction,
    targetUserId: string,
    targetUsername: string,
    reason?: string | null,
  ): Promise<void> {
    await this.prisma.auditLogEntry.create({
      data: { serverId, actorId, action, targetUserId, targetUsername, reason: reason ?? null },
    });
  }

  private async memberIds(serverId: string): Promise<string[]> {
    const members = await this.prisma.membership.findMany({
      where: { serverId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
}
