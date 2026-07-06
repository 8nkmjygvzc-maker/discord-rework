import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { FriendsList } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { FriendsService } from './friends.service';
import { AddFriendDto } from './dto/add-friend.dto';

@Controller('friends')
@UseGuards(AuthGuard, RateLimitGuard)
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  /** Freunde, offene Anfragen (ein/aus) und eigene Blockierungen. */
  @Get()
  list(@CurrentUser() user: AccessTokenPayload): Promise<FriendsList> {
    return this.friends.list(user.sub);
  }

  /** Anfrage per Benutzername (gedrosselt gegen Namens-Raten/Spam). */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit({ limit: 20, windowS: 60 })
  add(@CurrentUser() user: AccessTokenPayload, @Body() dto: AddFriendDto): Promise<void> {
    return this.friends.addByUsername(user.sub, dto.username);
  }

  /** Offene Anfrage des Nutzers `userId` annehmen. */
  @Post(':userId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.friends.accept(user.sub, userId);
  }

  /** Anfrage ablehnen/zurückziehen bzw. Freundschaft beenden. */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.friends.remove(user.sub, userId);
  }

  @Put(':userId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  block(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.friends.block(user.sub, userId);
  }

  @Delete(':userId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(
    @CurrentUser() user: AccessTokenPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.friends.unblock(user.sub, userId);
  }
}
