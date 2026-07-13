import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as argon2 from 'argon2';
import type { AuthUser } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from './token.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/** Argon2id-Parameter nach OWASP-Empfehlung (19 MiB, 2 Iterationen). */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Karenzzeit, in der ein bereits rotiertes Refresh-Token noch akzeptiert wird.
 * Nötig, weil parallele Refreshes legitim vorkommen (mehrere Tabs, React
 * StrictMode im Dev-Modus). Erst NACH der Karenzzeit gilt die Wiederverwendung
 * als Diebstahl-Indiz und beendet alle Sessions des Nutzers.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface AccessTokenPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<IssuedTokens> {
    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    try {
      const user = await this.prisma.user.create({
        data: {
          username: dto.username,
          email: dto.email.toLowerCase(),
          passwordHash,
        },
      });
      return this.issueTokens(user);
    } catch (e) {
      // P2002 = Unique-Constraint verletzt (username oder email vergeben)
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Benutzername oder E-Mail ist bereits vergeben');
      }
      throw e;
    }
  }

  async login(dto: LoginDto): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    // Bewusst dieselbe Fehlermeldung für "User existiert nicht" und "Passwort
    // falsch", damit sich keine registrierten E-Mails erraten lassen.
    if (!user || !(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('E-Mail oder Passwort ist falsch');
    }
    return this.issueTokens(user);
  }

  /**
   * Refresh mit Rotation: Das alte Token wird entwertet, ein neues ausgestellt.
   * Wird ein bereits entwertetes Token erneut vorgelegt (Diebstahl-Indiz),
   * werden vorsorglich alle Sessions des Nutzers beendet.
   */
  async refresh(presentedToken: string): Promise<IssuedTokens> {
    const tokenHash = hashRefreshToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Sitzung ungültig');

    if (stored.revokedAt) {
      const msSinceRevoked = Date.now() - stored.revokedAt.getTime();
      if (msSinceRevoked <= REFRESH_REUSE_GRACE_MS) {
        // Paralleler Refresh (zweiter Tab o. Ä.): neues Token ausstellen,
        // ohne die Rotation als Angriff zu werten.
        return this.issueTokens(stored.user);
      }
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sitzung ungültig');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Sitzung abgelaufen');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user);
  }

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: User): Promise<IssuedTokens> {
    const payload: AccessTokenPayload = { sub: user.id, username: user.username };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshTokenExpiry(),
      },
    });

    return { accessToken, refreshToken, user: toAuthUser(user) };
  }
}

/** Entfernt sensible Felder (passwordHash) aus dem DB-Objekt für die API-Antwort. */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
