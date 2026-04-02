import { Module } from '@nestjs/common';
import { LogoService } from './logo.service.js';

@Module({
  providers: [LogoService],
  exports: [LogoService],
})
export class LogoModule {}
