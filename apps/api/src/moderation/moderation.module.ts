import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { VoiceModule } from '../voice/voice.module';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

// AuthModule = AuthGuard, GatewayModule = Dispatch, RolesModule =
// PermissionsService (Rechte + Rang), VoiceModule = forceDisconnect.
@Module({
  imports: [AuthModule, GatewayModule, RolesModule, VoiceModule],
  controllers: [ModerationController],
  providers: [ModerationService],
})
export class ModerationModule {}
