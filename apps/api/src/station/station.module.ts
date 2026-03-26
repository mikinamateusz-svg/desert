import { Module } from '@nestjs/common';
import { StationService } from './station.service.js';
import { StationSyncService } from './station-sync.service.js';
import { StationSyncWorker } from './station-sync.worker.js';
import { StationSyncAdminService } from './station-sync-admin.service.js';
import { StationController } from './station.controller.js';
import { StationSyncAdminController } from './station-sync-admin.controller.js';

@Module({
  controllers: [StationController, StationSyncAdminController],
  providers: [StationService, StationSyncService, StationSyncWorker, StationSyncAdminService],
  exports: [StationService],
})
export class StationModule {}
