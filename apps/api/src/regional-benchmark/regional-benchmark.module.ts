import { Module } from '@nestjs/common';
import { RegionalBenchmarkService } from './regional-benchmark.service.js';
import { RegionalBenchmarkWorker } from './regional-benchmark.worker.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  // Hardening-2: RedisModule provides REDIS_CLIENT for the shared
  // non-blocking BullMQ Queue connection (drops 1 connection per worker).
  imports: [RedisModule],
  providers: [RegionalBenchmarkService, RegionalBenchmarkWorker],
  // Exported so Story 5.2 (FillUpService) and Story 3.7 (price validation tier 2)
  // can inject getLatestForStation without depending on the worker plumbing.
  exports: [RegionalBenchmarkService],
})
export class RegionalBenchmarkModule {}
