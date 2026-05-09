import { Module } from '@nestjs/common';
import { MarketSignalController } from './market-signal.controller.js';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { OrlenIngestionWorker } from './orlen-ingestion.worker.js';
import { StalenessDetectionService } from './staleness-detection.service.js';
import { StalenessDetectionWorker } from './staleness-detection.worker.js';
import { BrentIngestionService } from './brent-ingestion.service.js';
import { PriceRiseSignalPublisher } from './price-rise-signal.publisher.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  // RedisModule needed by BrentIngestionService (NBP rate cache).
  imports: [RedisModule],
  controllers: [MarketSignalController],
  providers: [
    PrismaService,
    OrlenIngestionService,
    OrlenIngestionWorker,
    StalenessDetectionService,
    StalenessDetectionWorker,
    // Story 6.0 — Brent ingestion + rise-signal publisher injected
    // into OrlenIngestionWorker.process(). Publisher is exported so
    // Story 6.3's PredictiveRiseAlertWorker can consume the queue.
    BrentIngestionService,
    PriceRiseSignalPublisher,
  ],
  exports: [StalenessDetectionService, PriceRiseSignalPublisher],
})
export class MarketSignalModule {}
