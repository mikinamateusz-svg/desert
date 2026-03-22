import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { initSuperTokens } from './supertokens.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {
  constructor(config: ConfigService) {
    initSuperTokens(
      config.getOrThrow('SUPERTOKENS_CONNECTION_URI'),
      config.getOrThrow('SUPERTOKENS_API_KEY'),
    );
  }
}
