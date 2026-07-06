import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [AuthModule, GatewayModule],
  controllers: [RolesController],
  providers: [RolesService, PermissionsService],
  exports: [RolesService, PermissionsService],
})
export class RolesModule {}
