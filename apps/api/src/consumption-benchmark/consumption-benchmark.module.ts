import { Module } from '@nestjs/common';
import { ConsumptionBenchmarkService } from './consumption-benchmark.service.js';
import { ConsumptionBenchmarkWorker } from './consumption-benchmark.worker.js';

@Module({
  providers: [ConsumptionBenchmarkService, ConsumptionBenchmarkWorker],
  // Exported so VehiclesController can inject getForVehicle for the new
  // GET /v1/me/vehicles/:id/benchmark endpoint (Story 5.6) without
  // depending on the worker plumbing.
  exports: [ConsumptionBenchmarkService],
})
export class ConsumptionBenchmarkModule {}
