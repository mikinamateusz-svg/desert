import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { VehiclesController } from './vehicles.controller.js';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService],
  // Exported so Story 5.2 (FillUpService) can call lockVehicle() on first
  // fill-up, and Story 5.6 (per-vehicle benchmarks) can read vehicle records.
  exports: [VehiclesService],
})
export class VehicleModule {}
