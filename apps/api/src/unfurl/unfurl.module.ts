import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UnfurlController } from './unfurl.controller';
import { UnfurlService } from './unfurl.service';

// AuthModule liefert den AuthGuard (JwtService); RedisService (RateLimitGuard)
// ist global.
@Module({
  imports: [AuthModule],
  controllers: [UnfurlController],
  providers: [UnfurlService],
})
export class UnfurlModule {}
