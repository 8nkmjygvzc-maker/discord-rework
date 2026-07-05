import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // .env liegt im Repo-Root; Fallback auf lokale .env im App-Ordner.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    HealthModule,
  ],
})
export class AppModule {}
