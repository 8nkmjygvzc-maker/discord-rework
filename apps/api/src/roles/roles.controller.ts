import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { RoleInfo } from '@parley/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AccessTokenPayload } from '../auth/auth.service';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Controller()
@UseGuards(AuthGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Post('servers/:serverId/roles')
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Body() dto: CreateRoleDto,
  ): Promise<RoleInfo> {
    return this.roles.create(serverId, user.sub, dto);
  }

  @Patch('roles/:id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleInfo> {
    return this.roles.update(id, user.sub, dto);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.roles.delete(id, user.sub);
  }

  @Put('servers/:serverId/members/:userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  assign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.roles.setMemberRole(serverId, targetUserId, roleId, user.sub, true);
  }

  @Delete('servers/:serverId/members/:userId/roles/:roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('serverId', ParseUUIDPipe) serverId: string,
    @Param('userId', ParseUUIDPipe) targetUserId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ): Promise<void> {
    return this.roles.setMemberRole(serverId, targetUserId, roleId, user.sub, false);
  }
}
