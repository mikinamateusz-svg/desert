import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// Mock supertokens-node recipes
const mockSignUp = jest.fn();
const mockSignIn = jest.fn();
const mockCreateSession = jest.fn();
const mockRevokeSession = jest.fn();

jest.mock('supertokens-node/recipe/emailpassword/index.js', () => ({
  __esModule: true,
  default: {
    signUp: (...args: unknown[]) => mockSignUp(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
  },
}));

jest.mock('supertokens-node/recipe/session/index.js', () => ({
  __esModule: true,
  default: {
    createNewSessionWithoutRequestResponse: (...args: unknown[]) =>
      mockCreateSession(...args),
    revokeSession: (...args: unknown[]) => mockRevokeSession(...args),
  },
}));

const mockUser = {
  id: 'user-uuid',
  supertokens_id: 'st-user-id',
  email: 'test@example.com',
  display_name: 'Test User',
  role: 'DRIVER',
  fleet_id: null,
  trust_score: 0,
  shadow_banned: false,
  deleted_at: null,
  deletion_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const mockPrismaService = {
  user: {
    create: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('should create a user and return accessToken on success', async () => {
      mockSignUp.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-user-id' },
        recipeUserId: { getAsString: () => 'st-user-id' },
      });
      mockPrismaService.user.create.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'mock-access-token',
      });

      const result = await service.register('test@example.com', 'password123', 'Test User');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.email).toBe('test@example.com');
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          supertokens_id: 'st-user-id',
          email: 'test@example.com',
          display_name: 'Test User',
          role: 'DRIVER',
        },
      });
    });

    it('should throw ConflictException when email already exists', async () => {
      mockSignUp.mockResolvedValueOnce({ status: 'EMAIL_ALREADY_EXISTS_ERROR' });

      await expect(
        service.register('existing@example.com', 'password123', 'User'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return accessToken on correct credentials', async () => {
      mockSignIn.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-user-id' },
        recipeUserId: { getAsString: () => 'st-user-id' },
      });
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'mock-access-token',
      });

      const result = await service.login('test@example.com', 'password123');

      expect(result.accessToken).toBe('mock-access-token');
      expect(result.user.role).toBe('DRIVER');
    });

    it('should throw UnauthorizedException on wrong credentials', async () => {
      mockSignIn.mockResolvedValueOnce({ status: 'WRONG_CREDENTIALS_ERROR' });

      await expect(
        service.login('test@example.com', 'wrongpass'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke the session', async () => {
      mockRevokeSession.mockResolvedValueOnce(undefined);

      await service.logout('session-handle-123');

      expect(mockRevokeSession).toHaveBeenCalledWith('session-handle-123');
    });
  });

  describe('getMe', () => {
    it('should return user by id', async () => {
      mockPrismaService.user.findUniqueOrThrow.mockResolvedValueOnce(mockUser);

      const result = await service.getMe('user-uuid');

      expect(result).toEqual(mockUser);
      expect(mockPrismaService.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
      });
    });
  });
});
