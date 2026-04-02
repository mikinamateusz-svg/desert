import { Module } from '@nestjs/common';
import { PhotoPipelineWorker } from './photo-pipeline.worker.js';
import { StationModule } from '../station/station.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StationModule, StorageModule],
  providers: [PhotoPipelineWorker],
  exports: [PhotoPipelineWorker],
})
export class PhotoModule {}
