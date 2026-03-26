import { Module } from '@nestjs/common';
import { OrlenIngestionService } from './orlen-ingestion.service.js';
import { OrlenIngestionWorker } from './orlen-ingestion.worker.js';

@Module({
  providers: [OrlenIngestionService, OrlenIngestionWorker],
})
export class MarketSignalModule {}
