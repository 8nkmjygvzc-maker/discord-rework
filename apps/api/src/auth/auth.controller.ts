import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { AuthResponse } from '@parley/shared';
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
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respondWithTokens(await this.auth.register(dto), res);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respondWithTokens(await this.auth.login(dto), res);
  }

  @Post('refresh')
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
