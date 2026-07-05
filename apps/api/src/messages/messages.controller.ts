import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { MessageHistoryResponse, MessageInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('channels/:channelId/messages')
@UseGuards(AuthGuard, RateLimitGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @RateLimit({ limit: 30, windowS: 30 }) // grober Spam-Schutz, verfeinert in Phase 14
  send(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageInfo> {
    return this.messages.send(channelId, user.sub, dto);
  }

  @Get()
  history(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('before') before?: string,
  ): Promise<MessageHistoryResponse> {
    return this.messages.history(channelId, user.sub, before);
  }
}
