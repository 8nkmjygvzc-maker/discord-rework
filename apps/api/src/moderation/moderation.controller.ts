import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { AuditLogEntryInfo, BanInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ModerationService } from './moderation.service';
import { ReasonDto } from './dto/reason.dto';
import { TimeoutDto } from './dto/timeout.dto';

/** REST-Endpunkte der Moderationswerkzeuge (Phase 13). */
@Controller()
@UseGuards(AuthGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Post('servers/:serverId/members/:userId/kick')
  @HttpCode(HttpStatus.NO_CONTENT)
  kick(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: ReasonDto,
  ): Promise<void> {
    return this.moderation.kick(serverId, user.sub, targetUserId, dto.reason);
  }

  @Get('servers/:serverId/bans')
  listBans(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<BanInfo[]> {
    return this.moderation.listBans(serverId, user.sub);
  }

  @Put('servers/:serverId/bans/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  ban(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: ReasonDto,
  ): Promise<void> {
    return this.moderation.ban(serverId, user.sub, targetUserId, dto.reason);
  }

  @Delete('servers/:serverId/bans/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unban(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    return this.moderation.unban(serverId, user.sub, targetUserId);
  }

  @Put('servers/:serverId/members/:userId/timeout')
  @HttpCode(HttpStatus.NO_CONTENT)
  timeout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Body() dto: TimeoutDto,
  ): Promise<void> {
    return this.moderation.timeout(
      serverId,
      user.sub,
      targetUserId,
      dto.durationSeconds,
      dto.reason,
    );
  }

  @Delete('servers/:serverId/members/:userId/timeout')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTimeout(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    return this.moderation.removeTimeout(serverId, user.sub, targetUserId);
  }

  @Post('servers/:serverId/members/:userId/voice-disconnect')
  @HttpCode(HttpStatus.NO_CONTENT)
  voiceDisconnect(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
  ): Promise<void> {
    return this.moderation.disconnectVoice(serverId, user.sub, targetUserId);
  }

  @Get('servers/:serverId/audit-log')
  auditLog(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<AuditLogEntryInfo[]> {
    return this.moderation.getAuditLog(serverId, user.sub);
  }
}
