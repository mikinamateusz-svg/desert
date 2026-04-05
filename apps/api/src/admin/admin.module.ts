import { Module } from '@nestjs/common';
import { AdminSubmissionsController } from './admin-submissions.controller.js';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PriceModule } from '../price/price.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [PrismaModule, PriceModule, StorageModule],
  controllers: [AdminSubmissionsController],
  providers: [AdminSubmissionsService],
})
export class AdminModule {}
