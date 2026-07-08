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
  UseGuards,
} from '@nestjs/common';
import type { ChannelInfo, ServerDetails, ServerSummary } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Controller()
@UseGuards(AuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post('servers')
  createServer(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreateServerDto,
  ): Promise<ServerDetails> {
    return this.servers.createServer(user.sub, dto);
  }

  @Get('servers')
  listMyServers(@CurrentUser() user: AccessTokenPayload): Promise<ServerSummary[]> {
    return this.servers.listMyServers(user.sub);
  }

  @Get('servers/:id')
  getServer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServerDetails> {
    return this.servers.getServerDetails(id, user.sub);
  }

  @Patch('servers/:id')
  updateServer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServerDto,
  ): Promise<ServerSummary> {
    return this.servers.updateServer(id, user.sub, dto);
  }

  @Delete('servers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteServer(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.servers.deleteServer(id, user.sub);
  }

  // Beitritt läuft seit Phase 12 ausschließlich über Einladungscodes
  // (POST /api/invites/:code) – der offene Beitritt per Server-ID ist entfernt.

  @Post('servers/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.servers.leave(id, user.sub);
  }

  @Post('servers/:id/channels')
  createChannel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateChannelDto,
  ): Promise<ChannelInfo> {
    return this.servers.createChannel(id, user.sub, dto);
  }

  @Patch('channels/:id')
  updateChannel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ): Promise<ChannelInfo> {
    return this.servers.updateChannel(id, user.sub, dto);
  }

  @Delete('channels/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteChannel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.servers.deleteChannel(id, user.sub);
  }
}
