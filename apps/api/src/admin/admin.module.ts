import { Module } from '@nestjs/common';
import { AdminSubmissionsController } from './admin-submissions.controller.js';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AnomalyDetectionService } from './anomaly-detection.service.js';
import { AdminDlqService } from './admin-dlq.service.js';
import { AdminDlqController } from './admin-dlq.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PriceModule } from '../price/price.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { UserModule } from '../user/user.module.js';
import { PhotoModule } from '../photo/photo.module.js';

@Module({
  imports: [PrismaModule, PriceModule, StorageModule, UserModule, PhotoModule],
  controllers: [AdminSubmissionsController, AdminUsersController, AdminDlqController],
  providers: [AdminSubmissionsService, AdminUsersService, AnomalyDetectionService, AdminDlqService],
})
export class AdminModule {}
