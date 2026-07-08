import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

// AuthModule liefert JwtModule (Voice-Token) + AuthGuard, GatewayModule den
// Dispatch, RolesModule die Rechteprüfung (PermissionsService).
@Module({
  imports: [AuthModule, GatewayModule, RolesModule],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
