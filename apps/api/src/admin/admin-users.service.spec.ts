import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockUserFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockAnomalyAlertGroupBy = jest.fn();
const mockAnomalyAlertFindMany = jest.fn();
const mockAnomalyAlertFindFirst = jest.fn();
const mockAnomalyAlertUpdate = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockSubmissionFindMany = jest.fn();
const mockSubmissionCount = jest.fn();

const mockPrisma = {
  user: {
    findMany: mockUserFindMany,
    count: mockUserCount,
    findUnique: mockUserFindUnique,
    update: mockUserUpdate,
  },
  anomalyAlert: {
    groupBy: mockAnomalyAlertGroupBy,
    findMany: mockAnomalyAlertFindMany,
    findFirst: mockAnomalyAlertFindFirst,
    update: mockAnomalyAlertUpdate,
  },
  adminAuditLog: { create: mockAuditLogCreate },
  submission: {
    findMany: mockSubmissionFindMany,
    count: mockSubmissionCount,
  },
};

const USER_ID = 'user-uuid-1';
const ADMIN_ID = 'admin-uuid-1';

const makeUser = (overrides = {}) => ({
  id: USER_ID,
  email: 'test@example.com',
  display_name: 'Test User',
  role: 'DRIVER',
  trust_score: 100,
  shadow_banned: false,
  created_at: new Date('2026-01-01'),
  _count: { submissions: 5, anomalyAlerts: 0 },
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockAuditLogCreate.mockResolvedValue({});
    mockAnomalyAlertGroupBy.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(AdminUsersService);
  });

  // ── listUsers ───────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('returns paginated user list', async () => {
      const user = makeUser();
      mockUserFindMany.mockResolvedValue([user]);
      mockUserCount.mockResolvedValue(1);
      mockAnomalyAlertGroupBy.mockResolvedValue([]);

      const result = await service.listUsers(1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(USER_ID);
      expect(result.data[0].trust_score).toBe(100);
      expect(result.data[0].active_alert_count).toBe(0);
      expect(result.total).toBe(1);
    });

    it('sets active_alert_count from groupBy results', async () => {
      const user = makeUser();
      mockUserFindMany.mockResolvedValue([user]);
      mockUserCount.mockResolvedValue(1);
      mockAnomalyAlertGroupBy.mockResolvedValue([{ user_id: USER_ID, _count: { id: 3 } }]);

      const result = await service.listUsers(1, 20);
      expect(result.data[0].active_alert_count).toBe(3);
    });
  });

  // ── getUser ─────────────────────────────────────────────────────────────────

  describe('getUser', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      await expect(service.getUser('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('returns user detail with submissions and alerts', async () => {
      mockUserFindUnique.mockResolvedValue({
        id: USER_ID,
        email: 'test@example.com',
        display_name: 'Test',
        role: 'DRIVER',
        trust_score: 100,
        shadow_banned: false,
        created_at: new Date('2026-01-01'),
        _count: { submissions: 2 },
      });
      mockSubmissionFindMany.mockResolvedValue([]);
      mockAnomalyAlertFindMany.mockResolvedValue([]);

      const result = await service.getUser(USER_ID);
      expect(result.id).toBe(USER_ID);
      expect(result.submission_count).toBe(2);
      expect(result.alerts).toEqual([]);
    });
  });

  // ── shadowBan ───────────────────────────────────────────────────────────────

  describe('shadowBan', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      await expect(service.shadowBan('nonexistent', ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('sets shadow_banned = true and writes audit log', async () => {
      mockUserFindUnique.mockResolvedValue({ id: USER_ID, role: 'DRIVER' });
      mockUserUpdate.mockResolvedValue({});

      await service.shadowBan(USER_ID, ADMIN_ID);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { shadow_banned: true },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admin_user_id: ADMIN_ID,
            action: 'SHADOW_BAN',
          }),
        }),
      );
    });
  });

  // ── unban ───────────────────────────────────────────────────────────────────

  describe('unban', () => {
    it('throws NotFoundException when user not found', async () => {
      mockUserFindUnique.mockResolvedValue(null);
      await expect(service.unban('nonexistent', ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('sets shadow_banned = false and writes audit log', async () => {
      mockUserFindUnique.mockResolvedValue({ id: USER_ID, role: 'DRIVER' });
      mockUserUpdate.mockResolvedValue({});

      await service.unban(USER_ID, ADMIN_ID);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { shadow_banned: false },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            admin_user_id: ADMIN_ID,
            action: 'UNBAN',
          }),
        }),
      );
    });
  });

  // ── dismissAlert ─────────────────────────────────────────────────────────────

  describe('dismissAlert', () => {
    it('throws NotFoundException when alert not found for user', async () => {
      mockAnomalyAlertFindFirst.mockResolvedValue(null);
      await expect(service.dismissAlert('alert-1', USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('sets dismissed_at on the alert', async () => {
      const alert = { id: 'alert-1', user_id: USER_ID, dismissed_at: null };
      mockAnomalyAlertFindFirst.mockResolvedValue(alert);
      mockAnomalyAlertUpdate.mockResolvedValue({});

      await service.dismissAlert('alert-1', USER_ID);

      expect(mockAnomalyAlertUpdate).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { dismissed_at: expect.any(Date) },
      });
    });
  });
});
