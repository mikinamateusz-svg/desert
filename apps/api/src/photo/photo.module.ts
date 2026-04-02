import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { OcrModule } from '../ocr/ocr.module.js';

@Module({
  imports: [StationModule, StorageModule, OcrModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
