import { Module, forwardRef } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { PhotoCleanupWorker } from './photo-cleanup.worker.js';
import { OcrSpendService } from './ocr-spend.service.js';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { LogoModule } from '../logo/logo.module.js';
import { PriceModule } from '../price/price.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UserModule } from '../user/user.module.js';
import { ResearchModule } from '../research/research.module.js';
import { SubmissionsModule } from '../submissions/submissions.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [
    StationModule,
    StorageModule,
    OcrModule,
    LogoModule,
    PriceModule,
    RedisModule,
    UserModule,
    ResearchModule,
    MetricsModule,
    forwardRef(() => SubmissionsModule),
  ],
  providers: [PhotoPipelineWorker, PhotoCleanupWorker, OcrSpendService, SubmissionDedupService],
  exports: [PhotoPipelineWorker, SubmissionDedupService, OcrSpendService],
})
export class PhotoModule {}
