import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { GoogleAuthDto } from './dto/google-auth.dto.js';
import { AppleAuthDto } from './dto/apple-auth.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { Public } from './decorators/public.decorator.js';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.displayName);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Any authenticated role — no @Roles() means "any authenticated user" per RolesGuard design
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('sessionHandle') sessionHandle: string) {
    return this.authService.logout(sessionHandle);
  }

  // Returns only safe fields — sensitive columns (supertokens_id, shadow_banned, etc.) are excluded
  @Get('me')
  me(@CurrentUser() user: User) {
    const { id, email, display_name, role } = user;
    return { id, email, display_name, role };
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  googleAuth(@Body() dto: GoogleAuthDto) {
    return this.authService.googleSignIn(dto.idToken);
  }

  @Public()
  @Post('apple')
  @HttpCode(200)
  appleAuth(@Body() dto: AppleAuthDto) {
    return this.authService.appleSignIn(dto.identityToken, dto.fullName);
  }

  /**
   * Exchange a refresh token for a fresh access token. Used by the mobile client
   * after receiving a 401 with type=TRY_REFRESH_TOKEN. Response rotates the
   * refresh token (SuperTokens best practice) — client must persist the new one.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshSession(dto.refreshToken);
  }
}
