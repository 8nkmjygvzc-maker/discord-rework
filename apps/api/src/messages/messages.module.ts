import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { FriendsModule } from '../friends/friends.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, GatewayModule, RolesModule, FriendsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
