import { Module } from '@nestjs/common';
import { RegionalBenchmarkService } from './regional-benchmark.service.js';
import { RegionalBenchmarkWorker } from './regional-benchmark.worker.js';

@Module({
  providers: [RegionalBenchmarkService, RegionalBenchmarkWorker],
  // Exported so Story 5.2 (FillUpService) and Story 3.7 (price validation tier 2)
  // can inject getLatestForStation without depending on the worker plumbing.
  exports: [RegionalBenchmarkService],
})
export class RegionalBenchmarkModule {}
