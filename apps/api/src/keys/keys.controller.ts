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
import type { DeviceKeyBundle, KeyBackupRecord, KeyEnvelopeInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { KeysService } from './keys.service';
import { RegisterKeysDto } from './dto/register-keys.dto';
import { SendEnvelopeDto } from './dto/send-envelope.dto';
import { PutBackupBlobDto, PutBackupDto } from './dto/put-backup.dto';

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

  /** Eigenes Schlüssel-Backup abrufen (Restore beim Login auf neuem Gerät). */
  @Get('keys/backup')
  getBackup(@CurrentUser() user: AccessTokenPayload): Promise<KeyBackupRecord> {
    return this.keys.getBackup(user.sub);
  }

  /** Backup einrichten bzw. ersetzen (Salt + umhüllter Master-Key + Blob). */
  @Put('keys/backup')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 10, windowS: 60 })
  putBackup(@CurrentUser() user: AccessTokenPayload, @Body() dto: PutBackupDto): Promise<void> {
    return this.keys.putBackup(user.sub, dto);
  }

  /** Zustands-Blob aktualisieren (debounced Sync des Clients). */
  @Put('keys/backup/blob')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 60, windowS: 60 })
  putBackupBlob(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: PutBackupBlobDto,
  ): Promise<void> {
    return this.keys.putBackupBlob(user.sub, dto);
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
