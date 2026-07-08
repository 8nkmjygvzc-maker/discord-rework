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
  UseGuards,
} from '@nestjs/common';
import type { InviteInfo, InvitePreview, ServerDetails } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('servers/:id/invites')
  @RateLimit({ limit: 20, windowS: 60 })
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInviteDto,
  ): Promise<InviteInfo> {
    return this.invites.create(id, user.sub, dto);
  }

  @Get('servers/:id/invites')
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InviteInfo[]> {
    return this.invites.list(id, user.sub);
  }

  /** Vorschau eines Codes (ohne beizutreten). Rate-Limit gegen Code-Raten. */
  @Get('invites/:code')
  @RateLimit({ limit: 30, windowS: 60 })
  preview(
    @CurrentUser() user: AccessTokenPayload,
    @Param('code') code: string,
  ): Promise<InvitePreview> {
    return this.invites.preview(code, user.sub);
  }

  /** Einlösen: tritt dem Server bei. */
  @Post('invites/:code')
  @RateLimit({ limit: 20, windowS: 60 })
  accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('code') code: string,
  ): Promise<ServerDetails> {
    return this.invites.accept(code, user.sub);
  }

  @Delete('invites/:code')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AccessTokenPayload, @Param('code') code: string): Promise<void> {
    return this.invites.revoke(code, user.sub);
  }
}
