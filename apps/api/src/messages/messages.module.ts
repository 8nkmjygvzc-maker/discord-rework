import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { FriendsModule } from '../friends/friends.module';
import { PushModule } from '../push/push.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ChannelAccessService } from './channel-access.service';

@Module({
  imports: [AuthModule, GatewayModule, RolesModule, FriendsModule, PushModule],
  controllers: [MessagesController],
  providers: [MessagesService, ChannelAccessService],
  // ChannelAccessService wird auch von den Anhängen (Phase 8) genutzt.
  exports: [ChannelAccessService],
})
export class MessagesModule {}
