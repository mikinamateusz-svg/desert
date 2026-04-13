import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { OcrSpendService } from './ocr-spend.service.js';
import { SubmissionDedupService } from './submission-dedup.service.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { LogoModule } from '../logo/logo.module.js';
import { PriceModule } from '../price/price.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [StationModule, StorageModule, OcrModule, LogoModule, PriceModule, RedisModule, UserModule],
  providers: [PhotoPipelineWorker, OcrSpendService, SubmissionDedupService],
  exports: [PhotoPipelineWorker, SubmissionDedupService, OcrSpendService],
})
export class PhotoModule {}
