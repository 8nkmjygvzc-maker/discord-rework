import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

// GatewayModule liefert PresenceService (Offline-Prüfung), AuthModule den
// AuthGuard/JwtService. PushService wird von Messages (DM-/Erwähnungs-Push)
// mitgenutzt → exportiert.
@Module({
  imports: [AuthModule, GatewayModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
