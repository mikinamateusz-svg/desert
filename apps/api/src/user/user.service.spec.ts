import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UserService } from './user.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

jest.mock('supertokens-node/recipe/session/index.js', () => ({
  __esModule: true,
  default: {
    revokeAllSessionsForUser: jest.fn(),
  },
}));

// Import after mock so we can reference the mocked function
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SessionMock = require('supertokens-node/recipe/session/index.js').default as {
  revokeAllSessionsForUser: jest.Mock;
};

const mockPrismaService = {
  user: {
    update: jest.fn(),
  },
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrismaService },
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
});
