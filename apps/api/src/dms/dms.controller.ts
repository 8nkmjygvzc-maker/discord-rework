import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { DmChannelInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { DmsService } from './dms.service';
import { OpenDmDto } from './dto/open-dm.dto';

@Controller('dms')
@UseGuards(AuthGuard, RateLimitGuard)
export class DmsController {
  constructor(private readonly dms: DmsService) {}

  /** Eigene DM-Kanäle (je mit Gesprächspartner). */
  @Get()
  list(@CurrentUser() user: AccessTokenPayload): Promise<DmChannelInfo[]> {
    return this.dms.listMine(user.sub);
  }

  /** DM-Kanal zu einem Nutzer öffnen (idempotent – existierender wird geliefert). */
  @Post()
  @RateLimit({ limit: 30, windowS: 60 })
  open(@CurrentUser() user: AccessTokenPayload, @Body() dto: OpenDmDto): Promise<DmChannelInfo> {
    return this.dms.open(user.sub, dto.userId);
  }
}
