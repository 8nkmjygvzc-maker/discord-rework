import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { StorageModule } from '../storage/storage.module';
import { SoundboardController } from './soundboard.controller';
import { SoundboardService } from './soundboard.service';

// AuthModule liefert den AuthGuard, GatewayModule den Dispatch, RolesModule
// die Rechteprüfung (PermissionsService), StorageModule die MinIO-Blobs.
@Module({
  imports: [AuthModule, GatewayModule, RolesModule, StorageModule],
  controllers: [SoundboardController],
  providers: [SoundboardService],
})
export class SoundboardModule {}
