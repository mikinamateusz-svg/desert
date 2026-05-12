import { Module } from '@nestjs/common';
import { StationService } from './station.service.js';
import { StationSyncService } from './station-sync.service.js';
import { StationClassificationService } from './station-classification.service.js';
import { StationClassificationWorker } from './station-classification.worker.js';
import { StationSyncWorker } from './station-sync.worker.js';
import { StationSyncAdminService } from './station-sync-admin.service.js';
import { StationController } from './station.controller.js';
import { StationSyncAdminController } from './station-sync-admin.controller.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  // Hardening-2: RedisModule provides REDIS_CLIENT for the shared
  // non-blocking BullMQ Queue connection (drops 1 connection per worker
  // for StationSyncWorker + StationClassificationWorker).
  imports: [RedisModule],
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
