import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { UnfurlResponse } from '@parley/shared';
import { AuthGuard } from '../auth/auth.guard';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { UnfurlService } from './unfurl.service';
import { UnfurlDto } from './dto/unfurl.dto';

/**
 * REST-Endpunkt für Link-Vorschauen (Feinschliff). Nur angemeldete Nutzer,
 * rate-limitiert (der Server stellt hier ausgehende Requests – nicht zum
 * Massen-Abruf missbrauchen lassen). Der SSRF-Schutz liegt im Service.
 */
@Controller('unfurl')
@UseGuards(AuthGuard, RateLimitGuard)
export class UnfurlController {
  constructor(private readonly unfurl: UnfurlService) {}

  @Post()
  @RateLimit({ limit: 30, windowS: 60 })
  async unfurlUrl(@Body() dto: UnfurlDto): Promise<UnfurlResponse> {
    return { embed: await this.unfurl.unfurl(dto.url) };
  }
}
