import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

const mockAuthResponse = {
  user: {
    id: 'user-uuid',
    email: 'test@example.com',
    display_name: 'Test User',
    role: 'DRIVER',
  },
  accessToken: 'mock-token',
};

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  getMe: jest.fn(),
  googleSignIn: jest.fn(),
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
    it('should call authService.getMe with userId', async () => {
      mockAuthService.getMe.mockResolvedValueOnce(mockAuthResponse.user);

      const result = await controller.me('user-uuid');

      expect(result).toEqual(mockAuthResponse.user);
      expect(mockAuthService.getMe).toHaveBeenCalledWith('user-uuid');
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
});
