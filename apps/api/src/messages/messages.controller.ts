import {
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
  UseGuards,
} from '@nestjs/common';
import type { MessageHistoryResponse, MessageInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { NotifyMentionsDto } from './dto/notify-mentions.dto';

@Controller('channels/:channelId')
@UseGuards(AuthGuard, RateLimitGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post('messages')
  @RateLimit({ limit: 30, windowS: 30 }) // grober Spam-Schutz, verfeinert in Phase 14
  send(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageInfo> {
    return this.messages.send(channelId, user.sub, dto);
  }

  @Get('messages')
  history(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Query('before') before?: string,
  ): Promise<MessageHistoryResponse> {
    return this.messages.history(channelId, user.sub, before);
  }

  /** Eigene Nachricht bearbeiten (Phase 13). */
  @Patch('messages/:messageId')
  @RateLimit({ limit: 30, windowS: 30 })
  edit(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageInfo> {
    return this.messages.editMessage(channelId, messageId, user.sub, dto);
  }

  /** Nachricht löschen (Autor oder ManageMessages in Server-Kanälen, Phase 13). */
  @Delete('messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 30, windowS: 30 })
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<void> {
    return this.messages.deleteMessage(channelId, messageId, user.sub);
  }

  /**
   * Erwähnungs-Push (Phase 12): Der Client meldet die erwähnten Mitglieder,
   * der Server pusht die offline unter ihnen. Verlangt Sende-Berechtigung.
   */
  @Post('notify-mentions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 30, windowS: 30 })
  notifyMentions(
    @CurrentUser() user: AccessTokenPayload,
    @Param('channelId', ParseUUIDPipe) channelId: string,
    @Body() dto: NotifyMentionsDto,
  ): Promise<void> {
    return this.messages.notifyMentions(channelId, user.sub, user.username, dto.userIds);
  }
}
