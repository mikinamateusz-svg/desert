import { Module } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { PhotoModule } from '../photo/photo.module.js';

@Module({
  imports: [StorageModule, PhotoModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
