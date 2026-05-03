import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { VehiclesController } from './vehicles.controller.js';
import { ConsumptionBenchmarkModule } from '../consumption-benchmark/consumption-benchmark.module.js';

@Module({
  // ConsumptionBenchmarkModule → benchmark lookup for the new
  // GET /v1/me/vehicles/:id/benchmark endpoint (Story 5.6).
  imports: [ConsumptionBenchmarkModule],
  controllers: [VehiclesController],
  providers: [VehiclesService],
  // Exported so Story 5.2 (FillUpService) can call lockVehicle() on first
  // fill-up.
  exports: [VehiclesService],
})
export class VehicleModule {}
