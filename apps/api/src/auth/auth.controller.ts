import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthResponse } from '@parley/shared';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { AuthService, IssuedTokens } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { REFRESH_TOKEN_TTL_DAYS } from './token.util';

export const REFRESH_COOKIE = 'parley_refresh';

/**
 * Das Refresh-Token wandert ausschließlich in ein httpOnly-Cookie:
 * JavaScript im Browser kann es nicht lesen (XSS-Schutz). Der Pfad ist auf
 * die Auth-Routen begrenzt, damit es nicht bei jedem API-Call mitgesendet wird.
 */
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
};

@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Enge Limits gegen Brute-Force/Spam: Registrierung und Login sind die
  // sensibelsten Endpunkte. Refresh läuft öfter legitim (mehrere Tabs).
  @Post('register')
  @RateLimit({ limit: 10, windowS: 300 })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respondWithTokens(await this.auth.register(dto), res);
  }

  @Post('login')
  @RateLimit({ limit: 10, windowS: 60 })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respondWithTokens(await this.auth.login(dto), res);
  }

  @Post('refresh')
  @RateLimit({ limit: 60, windowS: 60 })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const cookies = req.cookies as Record<string, string | undefined>;
    const presented = cookies[REFRESH_COOKIE];
    if (!presented) {
      res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
      throw new UnauthorizedException('Keine Sitzung');
    }
    try {
      return this.respondWithTokens(await this.auth.refresh(presented), res);
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookies = req.cookies as Record<string, string | undefined>;
    await this.auth.logout(cookies[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: refreshCookieOptions.path });
  }

  private respondWithTokens(tokens: IssuedTokens, res: Response): AuthResponse {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }
}
