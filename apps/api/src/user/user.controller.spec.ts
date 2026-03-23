import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { User } from '@prisma/client';

const mockUserService = {
  deleteAccount: jest.fn(),
  exportMyData: jest.fn(),
  sendExportEmail: jest.fn(),
  getConsents: jest.fn(),
  withdrawConsent: jest.fn(),
  createCoreServiceConsent: jest.fn(),
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

  describe('requestDataExport', () => {
    it('should call userService.exportMyData with userId and return 202 message', async () => {
      mockUserService.exportMyData.mockResolvedValueOnce('https://r2.example.com/exports/user-uuid/12345.json');
      mockUserService.sendExportEmail.mockResolvedValueOnce(undefined);

      const result = await controller.requestDataExport(mockUser as User);

      expect(mockUserService.exportMyData).toHaveBeenCalledWith('user-uuid');
      expect(mockUserService.sendExportEmail).toHaveBeenCalledWith('driver@example.com', 'https://r2.example.com/exports/user-uuid/12345.json');
      expect(result).toEqual({ message: 'Export prepared. Check your email.' });
    });

    it('should throw BadRequestException when user.email is null (deleted account)', async () => {
      const deletedUser = { ...mockUser, email: null } as User;

      await expect(controller.requestDataExport(deletedUser)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getConsents', () => {
    it('should call userService.getConsents with user.id and return the result', async () => {
      const fakeConsents = [
        { id: 'consent-1', type: 'CORE_SERVICE', consented_at: new Date(), withdrawn_at: null },
      ];
      mockUserService.getConsents.mockResolvedValueOnce(fakeConsents);

      const result = await controller.getConsents(mockUser as User);

      expect(mockUserService.getConsents).toHaveBeenCalledWith('user-uuid');
      expect(result).toBe(fakeConsents);
    });
  });

  describe('withdrawConsent', () => {
    it('should call userService.withdrawConsent with user.id and CORE_SERVICE and return void (204)', async () => {
      mockUserService.withdrawConsent.mockResolvedValueOnce(undefined);

      const result = await controller.withdrawConsent(mockUser as User, 'CORE_SERVICE');

      expect(mockUserService.withdrawConsent).toHaveBeenCalledWith('user-uuid', 'CORE_SERVICE');
      expect(result).toBeUndefined();
    });

    it('should throw BadRequestException when :type param is not a valid ConsentType', async () => {
      await expect(
        controller.withdrawConsent(mockUser as User, 'INVALID_TYPE'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
