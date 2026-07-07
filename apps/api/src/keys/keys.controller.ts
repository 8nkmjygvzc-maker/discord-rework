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
import type { DeviceKeyBundle, KeyEnvelopeInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { KeysService } from './keys.service';
import { RegisterKeysDto } from './dto/register-keys.dto';
import { SendEnvelopeDto } from './dto/send-envelope.dto';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class KeysController {
  constructor(private readonly keys: KeysService) {}

  /** Eigene öffentliche Geräteschlüssel hochladen/erneuern. */
  @Put('keys')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowS: 60 })
  register(@CurrentUser() user: AccessTokenPayload, @Body() dto: RegisterKeysDto): Promise<void> {
    return this.keys.registerKeys(user.sub, dto);
  }

  /** Schlüsselbündel eines Nutzers für X3DH (nur öffentliche Schlüssel). */
  @Get('users/:userId/keys')
  getBundle(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<DeviceKeyBundle> {
    return this.keys.getBundle(user.sub, userId);
  }

  /** Verschlüsselten Schlüssel-Umschlag zustellen (Sender-Key-Verteilung). */
  @Post('envelopes')
  @HttpCode(HttpStatus.NO_CONTENT)
  // Beim ersten Senden in einen großen Kanal geht ein Umschlag pro Mitglied raus.
  @RateLimit({ limit: 300, windowS: 60 })
  sendEnvelope(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SendEnvelopeDto,
  ): Promise<void> {
    return this.keys.sendEnvelope(user.sub, dto);
  }

  /** Eigene ungelesene Umschläge abholen (Abgleich nach Login/Reconnect). */
  @Get('envelopes')
  listEnvelopes(@CurrentUser() user: AccessTokenPayload): Promise<KeyEnvelopeInfo[]> {
    return this.keys.listEnvelopes(user.sub);
  }

  /** Umschlag als verarbeitet bestätigen (löschen, idempotent). */
  @Delete('envelopes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  ackEnvelope(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.keys.ackEnvelope(user.sub, id);
  }
}
