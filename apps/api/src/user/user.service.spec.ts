import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from './user.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

jest.mock('supertokens-node/recipe/session/index.js', () => ({
  __esModule: true,
  default: {
    revokeAllSessionsForUser: jest.fn(),
  },
}));

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ id: 'email-id' }) },
  })),
}));

// Import after mock so we can reference the mocked function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SessionMock = require('supertokens-node/recipe/session/index.js').default as {
  revokeAllSessionsForUser: jest.Mock;
};

const mockPrismaService = {
  user: {
    update: jest.fn(),
    findUnique: jest.fn(),
  },
  submission: {
    findMany: jest.fn(),
  },
  notificationPreference: {
    findFirst: jest.fn(),
  },
  userConsent: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockStorageService = {
  uploadBuffer: jest.fn().mockResolvedValue(undefined),
  getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.com/exports/user-uuid/12345.json'),
};

const mockConfigService = {
  get: jest.fn(),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('deleteAccount', () => {
    it('should call prisma.user.update with correct null fields and deleted_at', async () => {
      mockPrismaService.user.update.mockResolvedValueOnce({});
      SessionMock.revokeAllSessionsForUser.mockResolvedValueOnce(undefined);

      await service.deleteAccount('user-uuid', 'st-uuid');

      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: {
          email: null,
          display_name: null,
          supertokens_id: null,
          deleted_at: expect.any(Date),
        },
      });
    });

    it('should call Session.revokeAllSessionsForUser with the supertokens_id', async () => {
      mockPrismaService.user.update.mockResolvedValueOnce({});
      SessionMock.revokeAllSessionsForUser.mockResolvedValueOnce(undefined);

      await service.deleteAccount('user-uuid', 'st-uuid');

      expect(SessionMock.revokeAllSessionsForUser).toHaveBeenCalledWith('st-uuid');
    });

    it('should propagate error if prisma update fails (SuperTokens not called)', async () => {
      const dbError = new Error('DB connection failed');
      mockPrismaService.user.update.mockRejectedValueOnce(dbError);

      await expect(service.deleteAccount('user-uuid', 'st-uuid')).rejects.toThrow(
        'DB connection failed',
      );

      expect(SessionMock.revokeAllSessionsForUser).not.toHaveBeenCalled();
    });

    it('should NOT throw if SuperTokens revocation fails — logs error, deletion completes', async () => {
      mockPrismaService.user.update.mockResolvedValueOnce({});
      const stError = new Error('SuperTokens unreachable');
      SessionMock.revokeAllSessionsForUser.mockRejectedValueOnce(stError);

      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(service.deleteAccount('user-uuid', 'st-uuid')).resolves.toBeUndefined();

      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('exportMyData', () => {
    const userId = 'user-uuid';
    const fakeUser = {
      id: userId,
      email: 'driver@example.com',
      display_name: 'Test Driver',
      role: 'DRIVER',
      trust_score: 0,
      created_at: new Date('2026-01-01T00:00:00Z'),
    };
    const fakeSubmissions = [
      {
        id: 'sub-1',
        station_id: 'station-1',
        price_data: { price: 6.99 },
        status: 'APPROVED',
        created_at: new Date('2026-01-15T10:00:00Z'),
      },
    ];
    const fakePreferences = {
      price_drops: true,
      sharp_rise: false,
      monthly_summary: true,
    };

    beforeEach(() => {
      mockPrismaService.user.findUnique.mockResolvedValue(fakeUser);
      mockPrismaService.submission.findMany.mockResolvedValue(fakeSubmissions);
      mockPrismaService.notificationPreference.findFirst.mockResolvedValue(fakePreferences);
      mockStorageService.uploadBuffer.mockResolvedValue(undefined);
      mockStorageService.getPresignedUrl.mockResolvedValue('https://r2.example.com/exports/user-uuid/12345.json');
    });

    it('should call prisma.user.findUnique with correct userId', async () => {
      await service.exportMyData(userId);
      expect(mockPrismaService.user.findUnique).toHaveBeenCalledWith({ where: { id: userId } });
    });

    it('should call prisma.submission.findMany with correct userId and orderBy', async () => {
      await service.exportMyData(userId);
      expect(mockPrismaService.submission.findMany).toHaveBeenCalledWith({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
      });
    });

    it('should call storageService.uploadBuffer with key matching exports/${userId}/..., valid JSON buffer, and application/json content-type', async () => {
      await service.exportMyData(userId);
      expect(mockStorageService.uploadBuffer).toHaveBeenCalledTimes(1);
      const [key, buffer, contentType] = mockStorageService.uploadBuffer.mock.calls[0] as [string, Buffer, string];
      expect(key).toMatch(new RegExp(`^exports/${userId}/\\d+\\.json$`));
      expect(contentType).toBe('application/json');
      const parsed = JSON.parse(buffer.toString()) as Record<string, unknown>;
      expect(parsed).toHaveProperty('account');
      expect(parsed).toHaveProperty('submissions');
      expect(parsed).toHaveProperty('notification_preferences');
    });

    it('should call storageService.getPresignedUrl with the same key and 86400', async () => {
      await service.exportMyData(userId);
      const [uploadKey] = mockStorageService.uploadBuffer.mock.calls[0] as [string];
      expect(mockStorageService.getPresignedUrl).toHaveBeenCalledWith(uploadKey, 86400);
    });

    it('should return the presigned URL string', async () => {
      const url = await service.exportMyData(userId);
      expect(url).toBe('https://r2.example.com/exports/user-uuid/12345.json');
    });

    it('should propagate error when storageService.uploadBuffer rejects', async () => {
      mockStorageService.uploadBuffer.mockRejectedValueOnce(new Error('R2 upload failed'));

      await expect(service.exportMyData(userId)).rejects.toThrow('R2 upload failed');
    });
  });

  describe('sendExportEmail', () => {
    const email = 'driver@example.com';
    const downloadUrl = 'https://r2.example.com/exports/user-uuid/12345.json';

    it('should call resend.emails.send with correct from/to/subject fields when RESEND_API_KEY is set', async () => {
      mockConfigService.get.mockReturnValue('test-resend-api-key');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resend } = require('resend') as { Resend: jest.Mock };
      const mockSend = jest.fn().mockResolvedValue({ id: 'email-id' });
      Resend.mockImplementationOnce(() => ({ emails: { send: mockSend } }));

      await service.sendExportEmail(email, downloadUrl);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@desert.app',
          to: email,
          subject: 'Your Desert data export',
        }),
      );
    });

    it('should NOT throw when resend.emails.send fails — logs error only', async () => {
      mockConfigService.get.mockReturnValue('test-resend-api-key');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resend } = require('resend') as { Resend: jest.Mock };
      const mockSend = jest.fn().mockRejectedValueOnce(new Error('Email service down'));
      Resend.mockImplementationOnce(() => ({ emails: { send: mockSend } }));

      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      await expect(service.sendExportEmail(email, downloadUrl)).resolves.toBeUndefined();
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });

    it('should skip silently when RESEND_API_KEY is not set', async () => {
      mockConfigService.get.mockReturnValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resend } = require('resend') as { Resend: jest.Mock };
      Resend.mockClear();

      await expect(service.sendExportEmail(email, downloadUrl)).resolves.toBeUndefined();
      expect(Resend).not.toHaveBeenCalled();
    });
  });

  describe('createCoreServiceConsent', () => {
    const userId = 'user-uuid';

    it('should call prisma.userConsent.upsert with correct where and create args', async () => {
      mockPrismaService.userConsent.upsert.mockResolvedValueOnce({});

      await service.createCoreServiceConsent(userId);

      expect(mockPrismaService.userConsent.upsert).toHaveBeenCalledWith({
        where: { user_id_type: { user_id: userId, type: 'CORE_SERVICE' } },
        update: {},
        create: { user_id: userId, type: 'CORE_SERVICE' },
      });
    });

    it('should be idempotent — second call also calls upsert without throwing', async () => {
      mockPrismaService.userConsent.upsert.mockResolvedValue({});

      await service.createCoreServiceConsent(userId);
      await service.createCoreServiceConsent(userId);

      expect(mockPrismaService.userConsent.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('getConsents', () => {
    const userId = 'user-uuid';
    const fakeConsents = [
      { id: 'consent-1', user_id: userId, type: 'CORE_SERVICE', consented_at: new Date(), withdrawn_at: null, created_at: new Date(), updated_at: new Date() },
    ];

    it('should call prisma.userConsent.findMany with correct where and orderBy', async () => {
      mockPrismaService.userConsent.findMany.mockResolvedValueOnce(fakeConsents);

      await service.getConsents(userId);

      expect(mockPrismaService.userConsent.findMany).toHaveBeenCalledWith({
        where: { user_id: userId },
        orderBy: { consented_at: 'asc' },
      });
    });

    it('should return the result of findMany', async () => {
      mockPrismaService.userConsent.findMany.mockResolvedValueOnce(fakeConsents);

      const result = await service.getConsents(userId);

      expect(result).toBe(fakeConsents);
    });
  });

  describe('withdrawConsent', () => {
    const userId = 'user-uuid';

    it('should call prisma.userConsent.updateMany with correct where and data', async () => {
      mockPrismaService.userConsent.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.withdrawConsent(userId, 'CORE_SERVICE' as import('@prisma/client').ConsentType);

      expect(mockPrismaService.userConsent.updateMany).toHaveBeenCalledWith({
        where: { user_id: userId, type: 'CORE_SERVICE' },
        data: { withdrawn_at: expect.any(Date) },
      });
    });

    it('should NOT throw when updateMany returns count: 0 (no matching record)', async () => {
      mockPrismaService.userConsent.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.withdrawConsent(userId, 'CORE_SERVICE' as import('@prisma/client').ConsentType),
      ).resolves.toBeUndefined();
    });
  });
});
