import { Module } from '@nestjs/common';
import { MetricsCounterService } from './metrics-counter.service.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [RedisModule],
  providers: [MetricsCounterService],
  exports: [MetricsCounterService],
})
export class MetricsModule {}
