import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserService } from '../user/user.service.js';

// Mock supertokens-node recipes
const mockSignUp = jest.fn();
const mockSignIn = jest.fn();
const mockCreateSession = jest.fn();
const mockRevokeSession = jest.fn();
const mockManuallyCreateOrUpdateUser = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockVerifyAppleToken = jest.fn();

jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: {
    verifyIdToken: (...args: unknown[]) => mockVerifyAppleToken(...args),
  },
}));

jest.mock('google-auth-library', () => ({
  __esModule: true,
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
  })),
}));

jest.mock('supertokens-node/recipe/thirdparty/index.js', () => ({
  __esModule: true,
  default: {
    manuallyCreateOrUpdateUser: (...args: unknown[]) =>
      mockManuallyCreateOrUpdateUser(...args),
  },
}));

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
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  },
};

const mockUserService = {
  createCoreServiceConsent: jest.fn().mockResolvedValue(undefined),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env['GOOGLE_WEB_CLIENT_ID'] = 'test-google-client-id';
    process.env['APPLE_APP_BUNDLE_ID'] = 'com.desert.app.test';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: UserService, useValue: mockUserService },
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

    it('should call userService.createCoreServiceConsent after successful user creation', async () => {
      mockSignUp.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-user-id' },
        recipeUserId: { getAsString: () => 'st-user-id' },
      });
      mockPrismaService.user.create.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'mock-access-token',
      });

      await service.register('test@example.com', 'password123', 'Test User');

      expect(mockUserService.createCoreServiceConsent).toHaveBeenCalledWith(mockUser.id);
    });

    it('should still complete registration (session issued) if createCoreServiceConsent throws', async () => {
      mockSignUp.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-user-id' },
        recipeUserId: { getAsString: () => 'st-user-id' },
      });
      mockPrismaService.user.create.mockResolvedValueOnce(mockUser);
      mockUserService.createCoreServiceConsent.mockRejectedValueOnce(new Error('DB error'));
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'mock-access-token',
      });

      const result = await service.register('test@example.com', 'password123', 'Test User');

      expect(result.accessToken).toBe('mock-access-token');
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
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
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

  describe('googleSignIn', () => {
    const mockGooglePayload = {
      sub: 'google-uid-123',
      email: 'google@example.com',
      email_verified: true,
      name: 'Google User',
    };

    const mockTicket = {
      getPayload: () => mockGooglePayload,
    };

    it('should create a new user and return accessToken for first-time Google sign-in', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockTicket);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-google-id' },
        recipeUserId: { getAsString: () => 'st-google-id' },
        createdNewRecipeUser: true,
      });
      mockPrismaService.user.create.mockResolvedValueOnce({
        ...mockUser,
        supertokens_id: 'st-google-id',
        email: 'google@example.com',
        display_name: 'Google User',
      });
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'google-access-token',
      });

      const result = await service.googleSignIn('valid-id-token');

      expect(result.accessToken).toBe('google-access-token');
      expect(result.user.email).toBe('google@example.com');
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          supertokens_id: 'st-google-id',
          email: 'google@example.com',
          display_name: 'Google User',
          role: 'DRIVER',
        },
      });
    });

    it('should call userService.createCoreServiceConsent for new Google user', async () => {
      const newGoogleUser = { ...mockUser, supertokens_id: 'st-google-id', email: 'google@example.com' };
      mockVerifyIdToken.mockResolvedValueOnce(mockTicket);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-google-id' },
        recipeUserId: { getAsString: () => 'st-google-id' },
        createdNewRecipeUser: true,
      });
      mockPrismaService.user.create.mockResolvedValueOnce(newGoogleUser);
      mockCreateSession.mockResolvedValueOnce({ getAccessToken: () => 'google-access-token' });

      await service.googleSignIn('valid-id-token');

      expect(mockUserService.createCoreServiceConsent).toHaveBeenCalledWith(newGoogleUser.id);
    });

    it('should NOT call createCoreServiceConsent for returning Google user (createdNewRecipeUser = false)', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockTicket);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-google-id' },
        recipeUserId: { getAsString: () => 'st-google-id' },
        createdNewRecipeUser: false,
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({ getAccessToken: () => 'google-access-token' });

      await service.googleSignIn('valid-id-token');

      expect(mockUserService.createCoreServiceConsent).not.toHaveBeenCalled();
    });

    it('should find existing user and return accessToken for returning Google user', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockTicket);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-google-id' },
        recipeUserId: { getAsString: () => 'st-google-id' },
        createdNewRecipeUser: false,
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'google-access-token',
      });

      const result = await service.googleSignIn('valid-id-token');

      expect(result.accessToken).toBe('google-access-token');
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { supertokens_id: 'st-google-id' },
      });
    });

    it('should throw UnauthorizedException when Google ID token is invalid', async () => {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

      await expect(service.googleSignIn('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ConflictException with SOCIAL_EMAIL_CONFLICT when SuperTokens returns SIGN_IN_UP_NOT_ALLOWED', async () => {
      mockVerifyIdToken.mockResolvedValueOnce(mockTicket);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'SIGN_IN_UP_NOT_ALLOWED',
        reason: 'Email already registered via email/password',
      });

      await expect(service.googleSignIn('valid-id-token')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('appleSignIn', () => {
    const mockApplePayload = {
      sub: 'apple-uid-456',
      email: 'user@privaterelay.appleid.com',
    };

    it('should create a new user with display_name from fullName on first sign-in', async () => {
      mockVerifyAppleToken.mockResolvedValueOnce(mockApplePayload);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-apple-id' },
        recipeUserId: { getAsString: () => 'st-apple-id' },
        createdNewRecipeUser: true,
      });
      mockPrismaService.user.create.mockResolvedValueOnce({
        ...mockUser,
        supertokens_id: 'st-apple-id',
        email: 'user@privaterelay.appleid.com',
        display_name: 'Jane Doe',
      });
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'apple-access-token',
      });

      const result = await service.appleSignIn('valid-identity-token', {
        givenName: 'Jane',
        familyName: 'Doe',
      });

      expect(result.accessToken).toBe('apple-access-token');
      expect(mockPrismaService.user.create).toHaveBeenCalledWith({
        data: {
          supertokens_id: 'st-apple-id',
          email: 'user@privaterelay.appleid.com',
          display_name: 'Jane Doe',
          role: 'DRIVER',
        },
      });
    });

    it('should call userService.createCoreServiceConsent for new Apple user', async () => {
      const newAppleUser = { ...mockUser, supertokens_id: 'st-apple-id', email: 'user@privaterelay.appleid.com', display_name: 'Jane Doe' };
      mockVerifyAppleToken.mockResolvedValueOnce(mockApplePayload);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-apple-id' },
        recipeUserId: { getAsString: () => 'st-apple-id' },
        createdNewRecipeUser: true,
      });
      mockPrismaService.user.create.mockResolvedValueOnce(newAppleUser);
      mockCreateSession.mockResolvedValueOnce({ getAccessToken: () => 'apple-access-token' });

      await service.appleSignIn('valid-identity-token', { givenName: 'Jane', familyName: 'Doe' });

      expect(mockUserService.createCoreServiceConsent).toHaveBeenCalledWith(newAppleUser.id);
    });

    it('should find existing user on returning sign-in (fullName is null)', async () => {
      mockVerifyAppleToken.mockResolvedValueOnce(mockApplePayload);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'OK',
        user: { id: 'st-apple-id' },
        recipeUserId: { getAsString: () => 'st-apple-id' },
        createdNewRecipeUser: false,
      });
      mockPrismaService.user.findUnique.mockResolvedValueOnce(mockUser);
      mockCreateSession.mockResolvedValueOnce({
        getAccessToken: () => 'apple-access-token',
      });

      const result = await service.appleSignIn('valid-identity-token', null);

      expect(result.accessToken).toBe('apple-access-token');
      expect(mockPrismaService.user.create).not.toHaveBeenCalled();
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({
        where: { supertokens_id: 'st-apple-id' },
      });
      expect(mockUserService.createCoreServiceConsent).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when Apple identity token is invalid', async () => {
      mockVerifyAppleToken.mockRejectedValueOnce(new Error('Invalid token'));

      await expect(service.appleSignIn('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ConflictException with SOCIAL_EMAIL_CONFLICT when SuperTokens returns SIGN_IN_UP_NOT_ALLOWED', async () => {
      mockVerifyAppleToken.mockResolvedValueOnce(mockApplePayload);
      mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
        status: 'SIGN_IN_UP_NOT_ALLOWED',
        reason: 'Email already registered via email/password',
      });

      await expect(service.appleSignIn('valid-identity-token')).rejects.toThrow(
        ConflictException,
      );
    });
  });
});
