import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RolesModule } from '../roles/roles.module';
import { ServersModule } from '../servers/servers.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

// RolesModule liefert PermissionsService, ServersModule den ServersService
// (Beitritt inkl. Broadcasts), AuthModule den AuthGuard.
@Module({
  imports: [AuthModule, RolesModule, ServersModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
