import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';
import { LogoModule } from '../logo/logo.module.js';

@Module({
  imports: [StationModule, StorageModule, OcrModule, LogoModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
