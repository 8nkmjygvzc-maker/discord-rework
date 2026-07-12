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
import type { SoundboardSoundInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { SoundboardService } from './soundboard.service';
import { CreateSoundDto } from './dto/create-sound.dto';
import { UpdateSoundDto } from './dto/update-sound.dto';

@Controller()
@UseGuards(AuthGuard, RateLimitGuard)
export class SoundboardController {
  constructor(private readonly soundboard: SoundboardService) {}

  @Get('servers/:serverId/soundboard')
  @RateLimit({ limit: 60, windowS: 60 })
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
  ): Promise<SoundboardSoundInfo[]> {
    return this.soundboard.list(serverId, user.sub);
  }

  /**
   * Sound hochladen. Wie bei den Anhängen (Phase 8) ist der Body die rohe
   * Audiodatei als application/octet-stream; die Metadaten (Name, Emoji,
   * Lautstärke, MIME-Typ) reisen als Query-Parameter.
   */
  @Post('servers/:serverId/soundboard')
  @RateLimit({ limit: 20, windowS: 60 })
  upload(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Query() dto: CreateSoundDto,
    @Req() req: Request,
  ): Promise<SoundboardSoundInfo> {
    if (!Buffer.isBuffer(req.body)) {
      throw new BadRequestException('Audiodatei als application/octet-stream senden');
    }
    return this.soundboard.create(serverId, user.sub, dto, req.body);
  }

  @Patch('servers/:serverId/soundboard/:soundId')
  @RateLimit({ limit: 30, windowS: 60 })
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('soundId', ParseUUIDPipe) soundId: string,
    @Body() dto: UpdateSoundDto,
  ): Promise<SoundboardSoundInfo> {
    return this.soundboard.update(serverId, soundId, user.sub, dto);
  }

  @Delete('servers/:serverId/soundboard/:soundId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 30, windowS: 60 })
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('soundId', ParseUUIDPipe) soundId: string,
  ): Promise<void> {
    return this.soundboard.remove(serverId, soundId, user.sub);
  }

  /** Audio-Blob streamen (Clients cachen pro Sound-ID). */
  @Get('soundboard/:soundId/audio')
  @RateLimit({ limit: 120, windowS: 60 })
  async audio(
    @CurrentUser() user: AccessTokenPayload,
    @Param('soundId', ParseUUIDPipe) soundId: string,
  ): Promise<StreamableFile> {
    const { stream, sizeBytes, mimeType } = await this.soundboard.getAudio(soundId, user.sub);
    return new StreamableFile(stream, { type: mimeType, length: sizeBytes });
  }

  /** Sound im Sprachkanal abspielen (Event an alle, die gerade drinsitzen). */
  @Post('voice/channels/:channelId/soundboard/:soundId/play')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 20, windowS: 10 }) // Spam-Bremse, wie Mute-Toggeln
  play(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('soundId', ParseUUIDPipe) soundId: string,
  ): Promise<void> {
    return this.soundboard.play(channelId, soundId, user.sub, user.username);
  }
}
