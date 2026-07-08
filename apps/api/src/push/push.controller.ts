import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { VapidPublicKeyResponse } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { PushService } from './push.service';
import { SubscribeDto, UnsubscribeDto } from './dto/subscribe.dto';

/** REST-Endpunkte für Web-Push (Phase 12). */
@Controller('push')
@UseGuards(AuthGuard, RateLimitGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Öffentlicher VAPID-Schlüssel zum Anlegen der PushSubscription im Browser. */
  @Get('vapid-public-key')
  vapidPublicKey(): VapidPublicKeyResponse {
    return { publicKey: this.push.publicKey };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 20, windowS: 60 })
  subscribe(@CurrentUser() user: AccessTokenPayload, @Body() dto: SubscribeDto): Promise<void> {
    return this.push.subscribe(user.sub, dto);
  }

  @Post('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 20, windowS: 60 })
  unsubscribe(@CurrentUser() user: AccessTokenPayload, @Body() dto: UnsubscribeDto): Promise<void> {
    return this.push.unsubscribe(user.sub, dto.endpoint);
  }
}
