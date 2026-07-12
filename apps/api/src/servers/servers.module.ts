import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { StorageModule } from '../storage/storage.module';
import { ServersController, ServersPublicController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  imports: [AuthModule, GatewayModule, RolesModule, StorageModule],
  controllers: [ServersController, ServersPublicController],
  providers: [ServersService],
  exports: [ServersService],
})
export class ServersModule {}
