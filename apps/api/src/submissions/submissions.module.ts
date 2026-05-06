import { Module, forwardRef } from '@nestjs/common';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { PhotoModule } from '../photo/photo.module.js';
import { PriceModule } from '../price/price.module.js';

@Module({
  imports: [StorageModule, forwardRef(() => PhotoModule), PriceModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
