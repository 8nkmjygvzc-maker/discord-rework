import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FriendsModule } from '../friends/friends.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

// AuthModule liefert JwtModule (Voice-Token) + AuthGuard, GatewayModule den
// Dispatch, RolesModule die Rechteprüfung (PermissionsService), FriendsModule
// den Block-Check für private Anrufe (DM).
@Module({
  imports: [AuthModule, GatewayModule, RolesModule, FriendsModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  // ModerationModule (Phase 13) nutzt forceDisconnect für Voice-Trennungen.
  exports: [VoiceService],
})
export class VoiceModule {}
