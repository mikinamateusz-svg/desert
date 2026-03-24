import { Module } from '@nestjs/common';
import { StationService } from './station.service.js';
import { StationSyncService } from './station-sync.service.js';
import { StationSyncWorker } from './station-sync.worker.js';

@Module({
  providers: [StationService, StationSyncService, StationSyncWorker],
  exports: [StationService],
})
export class StationModule {}
