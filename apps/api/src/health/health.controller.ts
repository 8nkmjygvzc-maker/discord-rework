import { Controller, Get } from '@nestjs/common';
import type { HealthStatus } from '@parley/shared';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthStatus {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
    };
  }
}
