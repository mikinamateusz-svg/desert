import { Module } from '@nestjs/common';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { OrlenIngestionWorker } from './orlen-ingestion.worker.js';
import { StalenessDetectionService } from './staleness-detection.service.js';
import { StalenessDetectionWorker } from './staleness-detection.worker.js';

@Module({
  providers: [
    OrlenIngestionService,
    OrlenIngestionWorker,
    StalenessDetectionService,
    StalenessDetectionWorker,
  ],
  exports: [StalenessDetectionService],
})
export class MarketSignalModule {}
