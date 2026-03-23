import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
