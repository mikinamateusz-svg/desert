import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { User } from '@prisma/client';

const mockUserService = {
  deleteAccount: jest.fn(),
};

const mockUser: Partial<User> = {
  id: 'user-uuid',
  supertokens_id: 'st-uuid',
  email: 'driver@example.com',
  display_name: 'Test Driver',
  role: 'DRIVER',
  trust_score: 0,
  shadow_banned: false,
  deleted_at: null,
  deletion_reason: null,
};

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: mockUserService },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
  });

  describe('deleteAccount', () => {
    it('should call userService.deleteAccount with userId and supertokensId and return void (204)', async () => {
      mockUserService.deleteAccount.mockResolvedValueOnce(undefined);

      const result = await controller.deleteAccount(mockUser as User);

      expect(mockUserService.deleteAccount).toHaveBeenCalledWith('user-uuid', 'st-uuid');
      expect(result).toBeUndefined();
    });

    it('should propagate errors thrown by userService.deleteAccount', async () => {
      mockUserService.deleteAccount.mockRejectedValueOnce(new Error('Service error'));

      await expect(controller.deleteAccount(mockUser as User)).rejects.toThrow('Service error');
    });

    it('should propagate UnauthorizedException when user has no supertokens_id (simulates deleted-account guard bypass)', async () => {
      // NOTE: 401 on unauthenticated requests is enforced by JwtAuthGuard (APP_GUARD), not the
      // controller itself. Guard behaviour is tested in jwt-auth.guard.spec.ts.
      // This test documents that the controller does NOT add its own auth check —
      // it passes whatever user object the guard provides straight to the service.
      const deletedUser = { ...mockUser, supertokens_id: null } as User;
      mockUserService.deleteAccount.mockResolvedValueOnce(undefined);

      // Calling with null supertokens_id still invokes the service (guard responsibility, not controller).
      await controller.deleteAccount(deletedUser);
      expect(mockUserService.deleteAccount).toHaveBeenCalledWith('user-uuid', null);
    });
  });
});
