import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

// Global, weil Redis quer durch alle Module gebraucht wird (Presence,
// Rate-Limiting, Pub/Sub) – ein Import im AppModule genügt.
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
