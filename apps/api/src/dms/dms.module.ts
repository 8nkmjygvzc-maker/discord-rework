import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { FriendsModule } from '../friends/friends.module';
import { DmsController } from './dms.controller';
import { DmsService } from './dms.service';

@Module({
  imports: [AuthModule, GatewayModule, FriendsModule],
  controllers: [DmsController],
  providers: [DmsService],
})
export class DmsModule {}
