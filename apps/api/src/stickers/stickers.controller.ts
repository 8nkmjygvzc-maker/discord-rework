import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { StickerInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { StickersService } from './stickers.service';
import { CreateStickerDto } from './dto/create-sticker.dto';
import { UpdateStickerDto } from './dto/update-sticker.dto';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class StickersController {
  constructor(private readonly stickers: StickersService) {}

  @Get('servers/:serverId/stickers')
  @RateLimit({ limit: 60, windowS: 60 })
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<StickerInfo[]> {
    return this.stickers.list(serverId, user.sub);
  }

  /**
   * Sticker hochladen. Wie bei Anhängen/Soundboard ist der Body das rohe Bild
   * als application/octet-stream; die Metadaten (Name, MIME-Typ) reisen als
   * Query-Parameter.
   */
  @Post('servers/:serverId/stickers')
  @RateLimit({ limit: 20, windowS: 60 })
  upload(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Query() dto: CreateStickerDto,
    @Req() req: Request,
  ): Promise<StickerInfo> {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Bilddatei als application/octet-stream senden');
    }
    return this.stickers.create(serverId, user.sub, dto, req.body);
  }

  @Patch('servers/:serverId/stickers/:stickerId')
  @RateLimit({ limit: 30, windowS: 60 })
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('stickerId', ParseUUIDPipe) stickerId: string,
    @Body() dto: UpdateStickerDto,
  ): Promise<StickerInfo> {
    return this.stickers.update(serverId, stickerId, user.sub, dto);
  }

  @Delete('servers/:serverId/stickers/:stickerId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 30, windowS: 60 })
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('stickerId', ParseUUIDPipe) stickerId: string,
  ): Promise<void> {
    return this.stickers.remove(serverId, stickerId, user.sub);
  }

  /**
   * Bild-Blob streamen (Clients cachen pro Sticker-ID). Das Limit ist höher
   * als beim Soundboard: Beim Öffnen des Pickers bzw. Laden der History werden
   * viele Bilder auf einmal geholt.
   */
  @Get('stickers/:stickerId/image')
  @RateLimit({ limit: 240, windowS: 60 })
  async image(
    @CurrentUser() user: AccessTokenPayload,
    @Param('stickerId', ParseUUIDPipe) stickerId: string,
  ): Promise<StreamableFile> {
    const { stream, sizeBytes, mimeType } = await this.stickers.getImage(stickerId, user.sub);
    return new StreamableFile(stream, { type: mimeType, length: sizeBytes });
  }
}
