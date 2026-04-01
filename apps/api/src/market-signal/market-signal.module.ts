import { Module } from '@nestjs/common';
import { MarketSignalController } from './market-signal.controller.js';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { OrlenIngestionWorker } from './orlen-ingestion.worker.js';
import { StalenessDetectionService } from './staleness-detection.service.js';
import { StalenessDetectionWorker } from './staleness-detection.worker.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  controllers: [MarketSignalController],
  providers: [
    PrismaService,
    OrlenIngestionService,
    OrlenIngestionWorker,
    StalenessDetectionService,
    StalenessDetectionWorker,
  ],
  exports: [StalenessDetectionService],
})
export class MarketSignalModule {}
