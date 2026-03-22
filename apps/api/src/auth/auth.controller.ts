import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUser } from './current-user.decorator.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.displayName);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser('sessionHandle') sessionHandle: string) {
    return this.authService.logout(sessionHandle);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser('userId') userId: string) {
    return this.authService.getMe(userId);
  }
}
