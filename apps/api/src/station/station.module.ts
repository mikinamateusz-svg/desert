import { Module } from '@nestjs/common';
import { StationService } from './station.service.js';
import { StationSyncService } from './station-sync.service.js';
import { StationClassificationService } from './station-classification.service.js';
import { StationClassificationWorker } from './station-classification.worker.js';
import { StationSyncWorker } from './station-sync.worker.js';
import { StationSyncAdminService } from './station-sync-admin.service.js';
import { StationController } from './station.controller.js';
import { StationSyncAdminController } from './station-sync-admin.controller.js';

@Module({
  controllers: [StationController, StationSyncAdminController],
  // ClassificationService + ClassificationWorker listed before SyncWorker
  // because SyncWorker injects ClassificationWorker
  providers: [
    StationService,
    StationSyncService,
    StationClassificationService,
    StationClassificationWorker,
    StationSyncWorker,
    StationSyncAdminService,
  ],
  exports: [StationService],
})
export class StationModule {}
