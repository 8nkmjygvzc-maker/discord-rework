import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { VoiceJoinResponse } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { VoiceService } from './voice.service';
import { VoiceStateDto } from './dto/voice-state.dto';

@Controller('voice')
@UseGuards(AuthGuard, RateLimitGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('channels/:id/join')
  @RateLimit({ limit: 30, windowS: 60 }) // gegen Join-Flapping
  join(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VoiceJoinResponse> {
    return this.voice.join(user.sub, user.username, id);
  }

  @Post('channels/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.voice.leave(user.sub, user.username, id);
  }

  @Patch('channels/:id/state')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 60, windowS: 60 }) // Mute/Deafen-Toggeln drosseln (Broadcast-Spam)
  updateState(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoiceStateDto,
  ): Promise<void> {
    return this.voice.updateState(user.sub, user.username, id, dto);
  }
}
