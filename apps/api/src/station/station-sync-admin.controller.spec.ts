import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { StationSyncAdminController } from './station-sync-admin.controller.js';
import { StationSyncAdminService } from './station-sync-admin.service.js';
import { ROLES_KEY } from '../auth/decorators/roles.decorator.js';

const mockSyncAdminService = {
  triggerSync: jest.fn(),
  getStatus: jest.fn(),
};

describe('StationSyncAdminController', () => {
  let controller: StationSyncAdminController;
  let reflector: Reflector;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StationSyncAdminController],
      providers: [
        { provide: StationSyncAdminService, useValue: mockSyncAdminService },
      ],
    }).compile();

    controller = module.get<StationSyncAdminController>(StationSyncAdminController);
    reflector = new Reflector();
  });

  describe('RBAC metadata', () => {
    it('requires ADMIN role on the controller class', () => {
      const roles = reflector.get<UserRole[]>(ROLES_KEY, StationSyncAdminController);
      expect(roles).toContain(UserRole.ADMIN);
    });
  });

  describe('triggerSync', () => {
    it('returns 202 with queued result when sync is enqueued', async () => {
      mockSyncAdminService.triggerSync.mockResolvedValueOnce({ status: 'queued', jobId: 'job-1' });

      const result = await controller.triggerSync();

      expect(result).toEqual({ status: 'queued', jobId: 'job-1' });
    });

    it('throws ConflictException when sync is already running', async () => {
      mockSyncAdminService.triggerSync.mockResolvedValueOnce({
        status: 'already_running',
        jobId: 'job-running',
      });

      await expect(controller.triggerSync()).rejects.toThrow(ConflictException);
    });

    it('ConflictException contains the already_running payload', async () => {
      expect.assertions(2);
      const payload = { status: 'already_running', jobId: 'job-running' };
      mockSyncAdminService.triggerSync.mockResolvedValueOnce(payload);

      try {
        await controller.triggerSync();
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toMatchObject(payload);
      }
    });

    it('propagates errors thrown by service', async () => {
      mockSyncAdminService.triggerSync.mockRejectedValueOnce(new Error('Redis down'));

      await expect(controller.triggerSync()).rejects.toThrow('Redis down');
    });
  });

  describe('getSyncStatus', () => {
    it('returns sync status from service', async () => {
      const fakeStatus = {
        status: 'idle',
        lastCompletedAt: '2026-03-01T10:00:00.000Z',
        lastFailedAt: null,
        stationCount: 8000,
      };
      mockSyncAdminService.getStatus.mockResolvedValueOnce(fakeStatus);

      const result = await controller.getSyncStatus();

      expect(result).toEqual(fakeStatus);
    });

    it('propagates errors thrown by service', async () => {
      mockSyncAdminService.getStatus.mockRejectedValueOnce(new Error('DB down'));

      await expect(controller.getSyncStatus()).rejects.toThrow('DB down');
    });
  });
});
