import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ACCESS_TOKEN_TTL } from './token.util';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret === 'CHANGE_ME_GENERATE_RANDOM_64_HEX') {
          // Lieber sofort scheitern als mit unsicherem Secret laufen.
          throw new Error('JWT_SECRET fehlt oder ist der Beispielwert – bitte .env prüfen');
        }
        return { secret, signOptions: { expiresIn: ACCESS_TOKEN_TTL } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
