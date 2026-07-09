import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { RolesModule } from '../roles/roles.module';
import { FriendsModule } from '../friends/friends.module';
import { PushModule } from '../push/push.module';
import { StorageModule } from '../storage/storage.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { ChannelAccessService } from './channel-access.service';

@Module({
  // StorageModule (Phase 13): Blob-Aufräumen beim Löschen einer Nachricht.
  imports: [AuthModule, GatewayModule, RolesModule, FriendsModule, PushModule, StorageModule],
  controllers: [MessagesController],
  providers: [MessagesService, ChannelAccessService],
  // ChannelAccessService wird auch von den Anhängen (Phase 8) genutzt.
  exports: [ChannelAccessService],
})
export class MessagesModule {}
