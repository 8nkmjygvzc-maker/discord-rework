import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AccessTokenPayload): Promise<AuthUser> {
    return this.users.getById(user.sub);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<AuthUser> {
    return this.users.updateProfile(user.sub, dto);
  }

  /** Profilbild hochladen (Phase 15) – roher Bild-Body als octet-stream. */
  @Post('me/avatar')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowS: 60 })
  uploadAvatar(@CurrentUser() user: AccessTokenPayload, @Req() req: Request): Promise<AuthUser> {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Bild als application/octet-stream senden');
    }
    return this.users.setAvatar(user.sub, req.body);
  }

  /** Profil-Banner hochladen – roher Bild-Body als octet-stream. */
  @Post('me/banner')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowS: 60 })
  uploadBanner(@CurrentUser() user: AccessTokenPayload, @Req() req: Request): Promise<AuthUser> {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Bild als application/octet-stream senden');
    }
    return this.users.setBanner(user.sub, req.body);
  }
}

/**
 * Öffentliche Avatar-Auslieferung (Phase 15) – bewusst OHNE AuthGuard:
 * <img src> kann keine Bearer-Header mitschicken. Avatare gelten wie
 * Nutzernamen als öffentliche Metadaten; die User-ID (UUIDv4) ist nicht
 * erratbar. Trade-off in ROADMAP.md dokumentiert.
 */
@Controller('users')
export class UsersPublicController {
  constructor(private readonly users: UsersService) {}

  @Get(':id/avatar')
  // Die avatarUrl trägt eine ?v=-Query (Cache-Busting) → aggressiv cachebar.
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getAvatar(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { stream, sizeBytes, contentType } = await this.users.getAvatarStream(id);
    return new StreamableFile(stream, { type: contentType, length: sizeBytes });
  }

  @Get(':id/banner')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getBanner(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { stream, sizeBytes, contentType } = await this.users.getBannerStream(id);
    return new StreamableFile(stream, { type: contentType, length: sizeBytes });
  }
}
