import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GatewayModule } from '../gateway/gateway.module';
import { StorageModule } from '../storage/storage.module';
import { UsersController, UsersPublicController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, GatewayModule, StorageModule],
  controllers: [UsersController, UsersPublicController],
  providers: [UsersService],
})
export class UsersModule {}
