import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from '../auth/auth.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Nutzer nicht gefunden');
    return toAuthUser(user);
  }

  async updateProfile(id: string, dto: UpdateProfileDto): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
    });
    return toAuthUser(user);
  }
}
