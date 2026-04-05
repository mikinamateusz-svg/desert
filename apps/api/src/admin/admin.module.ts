import { Module } from '@nestjs/common';
import { AdminSubmissionsController } from './admin-submissions.controller.js';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AnomalyDetectionService } from './anomaly-detection.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PriceModule } from '../price/price.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [PrismaModule, PriceModule, StorageModule, UserModule],
  controllers: [AdminSubmissionsController, AdminUsersController],
  providers: [AdminSubmissionsService, AdminUsersService, AnomalyDetectionService],
})
export class AdminModule {}
