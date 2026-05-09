import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AlertsInboxService } from './alerts-inbox.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockFindFirst = jest.fn();
const mockFindUniqueOrThrow = jest.fn();
const mockUpdateMany = jest.fn();

const mockPrisma = {
  driverAlert: {
    findMany: mockFindMany,
    count: mockCount,
    findFirst: mockFindFirst,
    findUniqueOrThrow: mockFindUniqueOrThrow,
    updateMany: mockUpdateMany,
  },
};

const makeAlert = (overrides: Partial<{ id: string; user_id: string; read_at: Date | null }> = {}) => ({
  id: overrides.id ?? 'alert-1',
  user_id: overrides.user_id ?? 'user-1',
  alert_type: 'price_rise',
  title: 'Title',
  body: 'Body',
  sent_at: new Date('2026-05-09T10:00:00Z'),
  read_at: overrides.read_at ?? null,
  payload: { signalTypes: ['orlen_rack_pb95'] },
});

describe('AlertsInboxService', () => {
  let service: AlertsInboxService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertsInboxService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(AlertsInboxService);
  });

  // ── listForUser ────────────────────────────────────────────────────────────

  describe('listForUser', () => {
    it('returns paginated rows + total + unread count', async () => {
      mockFindMany.mockResolvedValue([makeAlert(), makeAlert({ id: 'alert-2', read_at: new Date() })]);
      mockCount.mockResolvedValueOnce(7).mockResolvedValueOnce(3);

      const result = await service.listForUser('user-1', 1, 20);

      expect(result.total).toBe(7);
      expect(result.unread_count).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('alert-1');
    });

    it('orders by sent_at DESC and paginates with skip/take', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await service.listForUser('user-1', 3, 25);

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: 'user-1' },
          orderBy: { sent_at: 'desc' },
          skip: 50, // (3-1) * 25
          take: 25,
        }),
      );
    });

    it('only returns rows belonging to the requesting user', async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await service.listForUser('user-1', 1, 20);

      // Both findMany and both count calls scope to user_id.
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'user-1' } }),
      );
      expect(mockCount).toHaveBeenCalledWith({ where: { user_id: 'user-1' } });
      expect(mockCount).toHaveBeenCalledWith({ where: { user_id: 'user-1', read_at: null } });
    });
  });

  // ── markRead ──────────────────────────────────────────────────────────────

  describe('markRead', () => {
    it('atomically claims the row via updateMany and returns the updated row', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValue(
        makeAlert({ read_at: new Date('2026-05-09T11:00:00Z') }),
      );

      const result = await service.markRead('user-1', 'alert-1');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: 'alert-1', user_id: 'user-1', read_at: null },
        data: { read_at: expect.any(Date) },
      });
      // P1 — no fallback findFirst when the claim succeeded.
      expect(mockFindFirst).not.toHaveBeenCalled();
      expect(result.read_at).not.toBeNull();
    });

    it('is idempotent — repeat call on already-read row returns the row without re-updating', async () => {
      const alreadyRead = makeAlert({ read_at: new Date('2026-05-09T09:00:00Z') });
      // Claim returns 0 (already read); fallback findFirst returns the row.
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(alreadyRead);

      const result = await service.markRead('user-1', 'alert-1');

      expect(result.id).toBe('alert-1');
      expect(mockFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("returns 404 when the alert doesn't exist for this user", async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'alert-x')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    it("returns 404 (not 403) when the alert belongs to another user — doesn't leak existence", async () => {
      // updateMany never matches a foreign-owned row (user_id filter); findFirst with
      // the same filter also returns null — both code paths converge on NotFound.
      mockUpdateMany.mockResolvedValue({ count: 0 });
      mockFindFirst.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'alert-of-user-2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('serialises concurrent first-tap wins — second concurrent call sees claim.count===0 and short-circuits', async () => {
      // First call claims successfully.
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce(
        makeAlert({ read_at: new Date('2026-05-09T11:00:00Z') }),
      );
      // Second call sees count=0 and falls through to findFirst.
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValueOnce(
        makeAlert({ read_at: new Date('2026-05-09T11:00:00Z') }),
      );

      const [a, b] = await Promise.all([
        service.markRead('user-1', 'alert-1'),
        service.markRead('user-1', 'alert-1'),
      ]);

      expect(a.read_at).not.toBeNull();
      expect(b.read_at).not.toBeNull();
      expect(mockUpdateMany).toHaveBeenCalledTimes(2);
      expect(mockFindUniqueOrThrow).toHaveBeenCalledTimes(1);
    });
  });

  // ── markAllRead ───────────────────────────────────────────────────────────

  describe('markAllRead', () => {
    it('updates only unread rows for the requesting user and returns count', async () => {
      mockUpdateMany.mockResolvedValue({ count: 4 });

      const result = await service.markAllRead('user-1');

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { user_id: 'user-1', read_at: null },
        data: { read_at: expect.any(Date) },
      });
      expect(result).toEqual({ marked_read: 4 });
    });

    it('returns marked_read: 0 when there are no unread alerts', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAllRead('user-1');

      expect(result).toEqual({ marked_read: 0 });
    });
  });
});
