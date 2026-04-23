import { Module } from '@nestjs/common';
import { ResearchRetentionService } from './research-retention.service.js';
import { AdminResearchService } from './admin-research.service.js';
import { AdminResearchController } from './admin-research.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [AdminResearchController],
  providers: [ResearchRetentionService, AdminResearchService],
  exports: [ResearchRetentionService],
})
export class ResearchModule {}
