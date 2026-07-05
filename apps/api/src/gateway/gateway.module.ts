import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayService } from './gateway.service';
import { PresenceService } from './presence.service';

// AuthModule re-exportiert das konfigurierte JwtModule → gleiche
// Token-Verifikation wie bei REST-Requests.
@Module({
  imports: [AuthModule],
  providers: [GatewayService, PresenceService],
  exports: [GatewayService, PresenceService],
})
export class GatewayModule {}
