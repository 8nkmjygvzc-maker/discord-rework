import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RedisService } from '../redis/redis.service';

export interface RateLimitOptions {
  /** Maximale Anzahl Requests pro Fenster. */
  limit: number;
  /** Fensterlänge in Sekunden. */
  windowS: number;
}

export const RATE_LIMIT_KEY = 'rate-limit';

/** Deklariert ein Rate-Limit pro Client-IP für eine Route (Fixed Window über Redis). */
export const RateLimit = (options: RateLimitOptions): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Einfaches Fixed-Window-Rate-Limit über Redis: funktioniert damit auch bei
 * mehreren API-Instanzen. Schlüssel: IP + Route. Hinter einem Reverse-Proxy
 * muss Express `trust proxy` gesetzt werden, damit req.ip die Client-IP ist
 * (siehe ROADMAP, vor öffentlichem Betrieb).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const key = `ratelimit:${req.ip ?? 'unbekannt'}:${req.method}:${req.path}`;

    const count = await this.redis.client.incr(key);
    // TTL nur beim ersten Treffer setzen – so bleibt das Fenster stabil.
    if (count === 1) await this.redis.client.expire(key, options.windowS);

    if (count > options.limit) {
      throw new HttpException(
        'Zu viele Anfragen – bitte kurz warten',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
