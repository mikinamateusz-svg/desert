import { Module } from '@nestjs/common';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { TrustScoreService } from './trust-score.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [StorageModule],
  controllers: [UserController],
  providers: [UserService, TrustScoreService],
  exports: [UserService, TrustScoreService],
})
export class UserModule {}
