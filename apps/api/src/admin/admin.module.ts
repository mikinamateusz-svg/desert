import { Module } from '@nestjs/common';
import { AdminSubmissionsController } from './admin-submissions.controller.js';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AnomalyDetectionService } from './anomaly-detection.service.js';
import { AdminDlqService } from './admin-dlq.service.js';
import { AdminDlqController } from './admin-dlq.controller.js';
import { AdminStationsService } from './admin-stations.service.js';
import { AdminStationsController } from './admin-stations.controller.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminMetricsController } from './admin-metrics.controller.js';
import { AdminOcrSpendController } from './admin-ocr-spend.controller.js';
import { AdminPriceRulesController } from './admin-price-rules.controller.js';
import { AdminPriceRulesService } from './admin-price-rules.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PriceModule } from '../price/price.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { UserModule } from '../user/user.module.js';
import { PhotoModule } from '../photo/photo.module.js';
import { MetricsModule } from '../metrics/metrics.module.js';

@Module({
  imports: [PrismaModule, PriceModule, StorageModule, UserModule, PhotoModule, MetricsModule],
  controllers: [AdminSubmissionsController, AdminUsersController, AdminDlqController, AdminStationsController, AdminMetricsController, AdminOcrSpendController, AdminPriceRulesController],
  providers: [AdminSubmissionsService, AdminUsersService, AnomalyDetectionService, AdminDlqService, AdminStationsService, AdminMetricsService, AdminPriceRulesService],
})
export class AdminModule {}
