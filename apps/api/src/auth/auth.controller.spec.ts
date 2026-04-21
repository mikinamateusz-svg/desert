import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

const mockFullUser = {
  id: 'user-uuid',
  supertokens_id: 'st-user-id',
  email: 'test@example.com',
  display_name: 'Test User',
  role: 'DRIVER' as const,
  fleet_id: null,
  trust_score: 0,
  shadow_banned: false,
  deleted_at: null,
  deletion_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockAuthResponse = {
  user: mockFullUser,
  accessToken: 'mock-token',
};

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  getMe: jest.fn(),
  googleSignIn: jest.fn(),
  appleSignIn: jest.fn(),
  refreshSession: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('register', () => {
    it('should call authService.register and return result', async () => {
      mockAuthService.register.mockResolvedValueOnce(mockAuthResponse);

      const result = await controller.register({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });

      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.register).toHaveBeenCalledWith(
        'test@example.com',
        'password123',
        'Test User',
      );
    });

    it('should propagate ConflictException from service', async () => {
      mockAuthService.register.mockRejectedValueOnce(
        new ConflictException({ error: 'EMAIL_ALREADY_EXISTS' }),
      );

      await expect(
        controller.register({
          email: 'existing@example.com',
          password: 'password123',
          displayName: 'User',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should call authService.login and return result', async () => {
      mockAuthService.login.mockResolvedValueOnce(mockAuthResponse);

      const result = await controller.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.login).toHaveBeenCalledWith(
        'test@example.com',
        'password123',
      );
    });

    it('should propagate UnauthorizedException from service', async () => {
      mockAuthService.login.mockRejectedValueOnce(
        new UnauthorizedException({ error: 'WRONG_CREDENTIALS' }),
      );

      await expect(
        controller.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should call authService.logout with sessionHandle', async () => {
      mockAuthService.logout.mockResolvedValueOnce(undefined);

      await controller.logout('session-handle-123');

      expect(mockAuthService.logout).toHaveBeenCalledWith('session-handle-123');
    });
  });

  describe('me', () => {
    it('should return the current user from request context directly', () => {
      const result = controller.me(mockFullUser);

      expect(result).toEqual({
        id: 'user-uuid',
        email: 'test@example.com',
        display_name: 'Test User',
        role: 'DRIVER',
      });
      // getMe() service call is no longer used — User is loaded by JwtAuthGuard
      expect(mockAuthService.getMe).not.toHaveBeenCalled();
    });
  });

  describe('googleAuth', () => {
    it('should call authService.googleSignIn with idToken and return result', async () => {
      mockAuthService.googleSignIn.mockResolvedValueOnce(mockAuthResponse);

      const result = await controller.googleAuth({ idToken: 'google-id-token' });

      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.googleSignIn).toHaveBeenCalledWith('google-id-token');
    });

    it('should propagate UnauthorizedException from service for invalid token', async () => {
      mockAuthService.googleSignIn.mockRejectedValueOnce(
        new UnauthorizedException({ error: 'INVALID_GOOGLE_TOKEN' }),
      );

      await expect(
        controller.googleAuth({ idToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('appleAuth', () => {
    it('should call authService.appleSignIn with identityToken and fullName', async () => {
      mockAuthService.appleSignIn.mockResolvedValueOnce(mockAuthResponse);
      const dto = {
        identityToken: 'apple-identity-token',
        fullName: { givenName: 'Jane', familyName: 'Doe' },
      };

      const result = await controller.appleAuth(dto);

      expect(result).toEqual(mockAuthResponse);
      expect(mockAuthService.appleSignIn).toHaveBeenCalledWith(
        'apple-identity-token',
        { givenName: 'Jane', familyName: 'Doe' },
      );
    });

    it('should propagate UnauthorizedException from service for invalid token', async () => {
      mockAuthService.appleSignIn.mockRejectedValueOnce(
        new UnauthorizedException({ error: 'INVALID_APPLE_TOKEN' }),
      );

      await expect(
        controller.appleAuth({ identityToken: 'bad-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('forwards refreshToken to service and returns result', async () => {
      mockAuthService.refreshSession.mockResolvedValueOnce({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      });

      const result = await controller.refresh({ refreshToken: 'old-refresh' });

      expect(result).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
      expect(mockAuthService.refreshSession).toHaveBeenCalledWith('old-refresh');
    });

    it('propagates UnauthorizedException from service when refresh fails', async () => {
      mockAuthService.refreshSession.mockRejectedValueOnce(
        new UnauthorizedException({ error: 'REFRESH_TOKEN_INVALID' }),
      );

      await expect(
        controller.refresh({ refreshToken: 'expired' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
