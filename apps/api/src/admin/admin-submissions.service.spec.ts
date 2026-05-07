import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import { AdminSubmissionsService } from './admin-submissions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceService } from '../price/price.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TrustScoreService } from '../user/trust-score.service.js';
import { PhotoPipelineWorker } from '../photo/photo-pipeline.worker.js';
import { SubmissionDedupService } from '../photo/submission-dedup.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSubmissionFindMany = jest.fn();
const mockSubmissionCount = jest.fn();
const mockSubmissionFindUnique = jest.fn();
const mockSubmissionUpdateMany = jest.fn();
const mockStalenessDeleteMany = jest.fn();
const mockAuditLogCreate = jest.fn();
// Story 3.17 — getDetail reads the latest USER_FLAGGED_WRONG audit row to
// surface restored_from_submission_id. Default null = no audit row.
const mockAuditLogFindFirst = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  submission: {
    findMany: mockSubmissionFindMany,
    count: mockSubmissionCount,
    findUnique: mockSubmissionFindUnique,
    updateMany: mockSubmissionUpdateMany,
  },
  stationFuelStaleness: { deleteMany: mockStalenessDeleteMany },
  adminAuditLog: { create: mockAuditLogCreate, findFirst: mockAuditLogFindFirst },
  $transaction: mockTransaction,
};

const mockSetVerifiedPrice = jest.fn();
const mockPriceService = { setVerifiedPrice: mockSetVerifiedPrice };

const mockDeleteObject = jest.fn();
const mockGetPresignedUrl = jest.fn();
const mockStorage = { deleteObject: mockDeleteObject, getPresignedUrl: mockGetPresignedUrl };

const mockUpdateScore = jest.fn();
const mockTrustScoreService = { updateScore: mockUpdateScore };

const mockWorkerRequeue = jest.fn();
const mockPhotoPipelineWorker = { requeue: mockWorkerRequeue };

// Story 3.16 — admin uses dedup service to seed consensus on approveNewer.
const mockRecordStationConsensus = jest.fn();
const mockSubmissionDedupService = {
  recordStationConsensus: mockRecordStationConsensus,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN_ID = 'admin-uuid-1';
const SUB_ID = 'sub-uuid-1';
const STATION_ID = 'station-uuid-1';

const makeShadowRejected = (overrides = {}) => ({
  id: SUB_ID,
  user_id: 'user-uuid-1',
  station_id: STATION_ID,
  price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
  photo_r2_key: 'submissions/user/sub.jpg',
  flag_reason: 'logo_mismatch',
  status: SubmissionStatus.shadow_rejected,
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminSubmissionsService', () => {
  let service: AdminSubmissionsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockTransaction.mockImplementation((fns: unknown[]) =>
      Promise.all((fns as Array<Promise<unknown>>).map((f) => f)),
    );
    mockAuditLogCreate.mockResolvedValue({});
    mockAuditLogFindFirst.mockResolvedValue(null);
    mockStalenessDeleteMany.mockResolvedValue({ count: 0 });
    mockSetVerifiedPrice.mockResolvedValue(undefined);
    mockDeleteObject.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://r2.example.com/presigned');
    mockUpdateScore.mockResolvedValue(undefined);
    mockWorkerRequeue.mockResolvedValue(undefined);
    mockRecordStationConsensus.mockResolvedValue(undefined);
    // Story 3.16 P-21 — cross-page partner pre-fetch in listFlagged calls
    // submission.findMany directly (outside the $transaction wrapper). Default
    // empty so non-conflict listFlagged tests don't need to set this up.
    mockSubmissionFindMany.mockResolvedValue([]);
    mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSubmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceService, useValue: mockPriceService },
        { provide: StorageService, useValue: mockStorage },
        { provide: TrustScoreService, useValue: mockTrustScoreService },
        { provide: PhotoPipelineWorker, useValue: mockPhotoPipelineWorker },
        { provide: SubmissionDedupService, useValue: mockSubmissionDedupService },
      ],
    }).compile();

    service = module.get(AdminSubmissionsService);
  });

  // ── listFlagged ─────────────────────────────────────────────────────────────

  describe('listFlagged', () => {
    it('returns paginated shadow_rejected submissions', async () => {
      const sub = {
        id: SUB_ID,
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-04-01'),
        user_id: 'user-1',
        flag_reason: 'logo_mismatch',
        conflict_group_id: null,
        station: { name: 'ORLEN Warszawa' },
      };
      mockTransaction.mockResolvedValue([[sub], 1]);

      const result = await service.listFlagged(1, 20);

      expect(result.data).toHaveLength(1);
      const item = result.data[0];
      if (item.kind !== 'single') throw new Error('expected single');
      expect(item.submission.station_name).toBe('ORLEN Warszawa');
      expect(item.submission.flag_reason).toBe('logo_mismatch');
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('falls back to logo_mismatch when flag_reason is null (legacy rows)', async () => {
      mockTransaction.mockResolvedValue([
        [{ id: SUB_ID, station_id: STATION_ID, price_data: [], ocr_confidence_score: null, created_at: new Date(), user_id: 'u1', flag_reason: null, conflict_group_id: null, station: null }],
        1,
      ]);
      const result = await service.listFlagged(1, 20);
      const item = result.data[0];
      if (item.kind !== 'single') throw new Error('expected single');
      expect(item.submission.flag_reason).toBe('logo_mismatch');
    });

    it('maps null station to null station_name', async () => {
      mockTransaction.mockResolvedValue([
        [{ id: SUB_ID, station_id: null, price_data: [], ocr_confidence_score: null, created_at: new Date(), user_id: 'u1', flag_reason: null, conflict_group_id: null, station: null }],
        1,
      ]);

      const result = await service.listFlagged(1, 20);
      const item = result.data[0];
      if (item.kind !== 'single') throw new Error('expected single');
      expect(item.submission.station_name).toBeNull();
    });

    // Story 3.16 — paired-card grouping by conflict_group_id

    it('collapses two rows sharing a conflict_group_id into a single pair (newer-first)', async () => {
      const groupId = 'group-uuid-1';
      const older = {
        id: 'sub-older',
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-05-07T10:00:00Z'),
        user_id: 'user-1',
        flag_reason: 'price_conflict',
        conflict_group_id: groupId,
        station: { name: 'ORLEN' },
      };
      const newer = {
        ...older,
        id: 'sub-newer',
        created_at: new Date('2026-05-07T15:00:00Z'),
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 7.1 }],
      };
      // findMany orders ASC by created_at — older first.
      mockTransaction.mockResolvedValue([[older, newer], 2]);

      const result = await service.listFlagged(1, 20);

      expect(result.data).toHaveLength(1);
      const item = result.data[0];
      if (item.kind !== 'pair') throw new Error('expected pair');
      expect(item.conflict_group_id).toBe(groupId);
      expect(item.newer.id).toBe('sub-newer');
      expect(item.older.id).toBe('sub-older');
    });

    it('renders an orphan partner (only one of the pair on this page) as a single row', async () => {
      const orphan = {
        id: 'sub-orphan',
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-05-07T10:00:00Z'),
        user_id: 'user-1',
        flag_reason: 'price_conflict',
        conflict_group_id: 'group-orphan',
        station: { name: 'ORLEN' },
      };
      mockTransaction.mockResolvedValue([[orphan], 1]);
      // Cross-page partner not present (returns empty).
      mockSubmissionFindMany.mockResolvedValueOnce([]);

      const result = await service.listFlagged(1, 20);

      expect(result.data).toHaveLength(1);
      const item = result.data[0];
      if (item.kind !== 'single') throw new Error('expected single fallback for orphan');
      expect(item.submission.id).toBe('sub-orphan');
    });

    it('P-21 — collapses pair when partner is on a different page (cross-page lookup)', async () => {
      const groupId = 'group-uuid-xpage';
      // Page 1 contains only the older row.
      const olderInPage = {
        id: 'sub-older',
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.5 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-05-07T10:00:00Z'),
        user_id: 'user-1',
        flag_reason: 'price_conflict',
        conflict_group_id: groupId,
        station: { name: 'ORLEN' },
      };
      // Newer row lives on a later page; the cross-page lookup pulls it.
      const newerCrossPage = {
        ...olderInPage,
        id: 'sub-newer',
        created_at: new Date('2026-05-07T15:00:00Z'),
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 7.1 }],
      };
      mockTransaction.mockResolvedValue([[olderInPage], 1]);
      // Note: the in-page transaction-wrapped findMany is shadowed by
      // mockTransaction's canned value — but Prisma's $transaction takes
      // pre-created promises, so the underlying mock is invoked once for
      // the in-page query (return value ignored) and once for the cross-
      // page lookup. Discriminate via the where filter.
      mockSubmissionFindMany.mockImplementation(
        (args: { where?: { conflict_group_id?: { in: string[] } } }) =>
          Promise.resolve(
            Array.isArray(args?.where?.conflict_group_id?.in) ? [newerCrossPage] : [],
          ),
      );

      const result = await service.listFlagged(1, 20);

      expect(result.data).toHaveLength(1);
      const item = result.data[0];
      if (item.kind !== 'pair') throw new Error('expected pair from cross-page lookup');
      expect(item.newer.id).toBe('sub-newer');
      expect(item.older.id).toBe('sub-older');
    });
  });

  // ── Story 3.16: paired-review actions ─────────────────────────────────────

  describe('approveNewer / markNewerUnusable / markBothUnusable', () => {
    const GROUP_ID = '00000000-0000-4000-8000-000000000001';
    const NEWER_ID = '00000000-0000-4000-8000-0000000000ne';
    const OLDER_ID = '00000000-0000-4000-8000-0000000000ol';

    type ConflictRow = {
      id: string;
      station_id: string;
      price_data: Array<{ fuel_type: string; price_per_litre: number | null }>;
      ocr_confidence_score: number;
      created_at: Date;
      user_id: string;
      flag_reason: string;
      conflict_group_id: string;
      station: { name: string };
    };

    const makeRows = (): ConflictRow[] => [
      // findMany returns desc by created_at — newer first.
      {
        id: NEWER_ID,
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 7.1 }],
        ocr_confidence_score: 0.9,
        created_at: new Date('2026-05-07T15:00:00Z'),
        user_id: 'user-newer',
        flag_reason: 'price_conflict',
        conflict_group_id: GROUP_ID,
        station: { name: 'ORLEN' },
      },
      {
        id: OLDER_ID,
        station_id: STATION_ID,
        price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.49 }],
        ocr_confidence_score: 0.92,
        created_at: new Date('2026-05-07T10:00:00Z'),
        user_id: 'user-older',
        flag_reason: 'price_conflict',
        conflict_group_id: GROUP_ID,
        station: { name: 'ORLEN' },
      },
    ];

    beforeEach(() => {
      // P-9 — actions wrap their two updateMany calls in a $transaction
      // callback. The default beforeEach implementation handles array form;
      // for callback form we override here.
      mockTransaction.mockImplementation(async (fn: unknown) => {
        if (typeof fn === 'function') {
          // The callback receives a tx with submission.updateMany
          return await (fn as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
        }
        return Promise.all((fn as Array<Promise<unknown>>).map((f) => f));
      });
    });

    describe('approveNewer', () => {
      it('flips newer→verified, older→rejected with auto_resolved_by_newer, writes cache, seeds consensus (P-9, P-12, P-24)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

        await service.approveNewer(ADMIN_ID, GROUP_ID, NEWER_ID);

        // Both flips ran with status guards.
        const newerFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === NEWER_ID,
        );
        expect(newerFlip[0].data).toEqual({ status: 'verified', flag_reason: null });
        const olderFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === OLDER_ID,
        );
        expect(olderFlip[0].data).toEqual({
          status: 'rejected',
          flag_reason: 'auto_resolved_by_newer',
        });
        // Cache written with newer prices.
        expect(mockSetVerifiedPrice).toHaveBeenCalled();
        // P-24: consensus seeded confirmed=true.
        expect(mockRecordStationConsensus).toHaveBeenCalledWith(
          STATION_ID,
          expect.objectContaining({ count: 2, confirmed: true }),
        );
        // P-12: distinct audit actions per row.
        const auditCalls = mockAuditLogCreate.mock.calls.map(
          ([{ data }]: [{ data: { action: string; submission_id: string } }]) => ({
            action: data.action,
            sub: data.submission_id,
          }),
        );
        expect(auditCalls).toContainEqual({ action: 'APPROVE_NEWER', sub: NEWER_ID });
        expect(auditCalls).toContainEqual({ action: 'AUTO_RESOLVED_BY_NEWER', sub: OLDER_ID });
      });

      it('throws ConflictException + rolls back when older flip returns count: 0', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        // Newer flip succeeds, older flip returns 0 (concurrent action moved it)
        mockSubmissionUpdateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 });

        await expect(service.approveNewer(ADMIN_ID, GROUP_ID, NEWER_ID)).rejects.toThrow(
          ConflictException,
        );
      });

      it('throws BadRequestException when submitted newerSubmissionId is not the newer half', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        await expect(
          service.approveNewer(ADMIN_ID, GROUP_ID, OLDER_ID),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws ConflictException when pair is no longer intact (rows < 2)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce([makeRows()[0]]);
        await expect(
          service.approveNewer(ADMIN_ID, GROUP_ID, NEWER_ID),
        ).rejects.toThrow(ConflictException);
      });

      it('throws ConflictException when group has > 2 active members (P-22)', async () => {
        const rows = makeRows();
        const third = { ...rows[1], id: 'sub-third', created_at: new Date('2026-05-07T08:00:00Z') };
        mockSubmissionFindMany.mockResolvedValueOnce([...rows, third]);
        await expect(
          service.approveNewer(ADMIN_ID, GROUP_ID, NEWER_ID),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('markNewerUnusable', () => {
      it('rejects newer + releases older to single-row review with distinct audit actions', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

        await service.markNewerUnusable(ADMIN_ID, GROUP_ID, NEWER_ID);

        const newerFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === NEWER_ID,
        );
        expect(newerFlip[0].data).toEqual({
          status: 'rejected',
          flag_reason: 'admin_marked_unusable',
        });
        const olderFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === OLDER_ID,
        );
        expect(olderFlip[0].data).toEqual({
          flag_reason: null,
          conflict_group_id: null,
        });
        // P-12: distinct audit actions
        const auditActions = mockAuditLogCreate.mock.calls.map(
          ([{ data }]: [{ data: { action: string } }]) => data.action,
        );
        expect(auditActions).toContain('MARK_NEWER_UNUSABLE');
        expect(auditActions).toContain('RELEASE_OLDER_TO_SINGLE_REVIEW');
        // No cache write or consensus seed on the unusable path.
        expect(mockSetVerifiedPrice).not.toHaveBeenCalled();
        expect(mockRecordStationConsensus).not.toHaveBeenCalled();
      });

      it('throws ConflictException + rolls back when older release returns count: 0', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany
          .mockResolvedValueOnce({ count: 1 }) // newer flip ok
          .mockResolvedValueOnce({ count: 0 }); // older release: 0

        await expect(
          service.markNewerUnusable(ADMIN_ID, GROUP_ID, NEWER_ID),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('markBothUnusable', () => {
      it('rejects both rows + audits only the rows it actually flipped (P-10)', async () => {
        // First findMany: targets pre-update (capture what we WILL flip).
        // updateMany returns count: 2.
        mockSubmissionFindMany.mockResolvedValueOnce([
          { id: NEWER_ID },
          { id: OLDER_ID },
        ]);
        mockSubmissionUpdateMany.mockResolvedValueOnce({ count: 2 });

        await service.markBothUnusable(ADMIN_ID, GROUP_ID);

        const updateCall = mockSubmissionUpdateMany.mock.calls[0][0];
        expect(updateCall.where).toEqual(
          expect.objectContaining({
            id: { in: [NEWER_ID, OLDER_ID] },
            status: 'shadow_rejected',
            flag_reason: 'price_conflict',
          }),
        );
        expect(updateCall.data).toEqual({
          status: 'rejected',
          flag_reason: 'admin_marked_unusable',
        });
        // P-10: audit only the rows we captured pre-update.
        expect(mockAuditLogCreate).toHaveBeenCalledTimes(2);
      });

      it('throws ConflictException when no rows match the price_conflict pre-flip predicate', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce([]);
        await expect(service.markBothUnusable(ADMIN_ID, GROUP_ID)).rejects.toThrow(
          ConflictException,
        );
        // No updateMany when targets is empty.
        expect(mockSubmissionUpdateMany).not.toHaveBeenCalled();
      });

      it('does NOT throw when an audit log write fails (P-11 best-effort)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce([{ id: NEWER_ID }, { id: OLDER_ID }]);
        mockSubmissionUpdateMany.mockResolvedValueOnce({ count: 2 });
        mockAuditLogCreate
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('DB hiccup'));

        await expect(service.markBothUnusable(ADMIN_ID, GROUP_ID)).resolves.toBeUndefined();
      });
    });

    // Story 3.17 — symmetric Approve older action.
    describe('approveOlder', () => {
      it('flips older→verified, newer→rejected with auto_resolved_by_older, writes cache, seeds consensus', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        // P-16 (3.17 review) — explicit per-call mocks instead of a blanket
        // mockResolvedValue({ count: 1 }) so a regression that drops one
        // updateMany call is caught by the toHaveBeenCalledTimes(2) below.
        mockSubmissionUpdateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 });

        await service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID);

        expect(mockSubmissionUpdateMany).toHaveBeenCalledTimes(2);
        const olderFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === OLDER_ID,
        );
        expect(olderFlip[0].data).toEqual({ status: 'verified', flag_reason: null });
        const newerFlip = mockSubmissionUpdateMany.mock.calls.find(
          ([args]: [{ where: { id: string } }]) => args.where.id === NEWER_ID,
        );
        expect(newerFlip[0].data).toEqual({
          status: 'rejected',
          flag_reason: 'auto_resolved_by_older',
        });
        expect(mockSetVerifiedPrice).toHaveBeenCalled();
        expect(mockRecordStationConsensus).toHaveBeenCalledWith(
          STATION_ID,
          expect.objectContaining({ count: 2, confirmed: true }),
        );
        const auditActions = mockAuditLogCreate.mock.calls.map(
          ([{ data }]: [{ data: { action: string; submission_id: string } }]) => ({
            action: data.action,
            sub: data.submission_id,
          }),
        );
        expect(auditActions).toContainEqual({ action: 'APPROVE_OLDER', sub: OLDER_ID });
        expect(auditActions).toContainEqual({ action: 'AUTO_RESOLVED_BY_OLDER', sub: NEWER_ID });
      });

      it('throws ConflictException when newer flip returns count: 0 (transactional rollback)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany
          .mockResolvedValueOnce({ count: 1 }) // older flip ok
          .mockResolvedValueOnce({ count: 0 }); // newer flip 0 → roll back

        await expect(service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID)).rejects.toThrow(
          ConflictException,
        );
      });

      it('throws BadRequestException when submitted id is the newer half (loadConflictPair guard)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        await expect(
          service.approveOlder(ADMIN_ID, GROUP_ID, NEWER_ID),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws ConflictException when group has > 2 active members', async () => {
        const rows = makeRows();
        const third = { ...rows[1], id: 'sub-third', created_at: new Date('2026-05-07T08:00:00Z') };
        mockSubmissionFindMany.mockResolvedValueOnce([...rows, third]);
        await expect(
          service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID),
        ).rejects.toThrow(ConflictException);
      });

      // P-17 (3.17 review) — failure-tolerance coverage to match the 3.16
      // P-11 pattern. Audit log + cache-write failures are both `.catch()`-
      // wrapped; the action should still resolve so the admin sees success
      // for the load-bearing DB transitions.
      it('does NOT throw when audit log write fails (best-effort)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
        mockAuditLogCreate.mockRejectedValueOnce(new Error('DB hiccup'));

        await expect(
          service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID),
        ).resolves.toBeUndefined();
      });

      it('does NOT throw when setVerifiedPrice fails (best-effort cache write)', async () => {
        mockSubmissionFindMany.mockResolvedValueOnce(makeRows());
        mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
        mockSetVerifiedPrice.mockRejectedValueOnce(new Error('Redis unavailable'));

        await expect(
          service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID),
        ).resolves.toBeUndefined();
        // Consensus seed runs after cache write, regardless of cache-write outcome.
        expect(mockRecordStationConsensus).toHaveBeenCalled();
      });

      it('P-3 — skips cache write and consensus seed when older has no finite prices', async () => {
        const rows = makeRows();
        // Strip prices from older to all-null so validOlderPrices is empty.
        rows[1].price_data = [{ fuel_type: 'PB_95', price_per_litre: null }];
        mockSubmissionFindMany.mockResolvedValueOnce(rows);
        mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

        await service.approveOlder(ADMIN_ID, GROUP_ID, OLDER_ID);

        expect(mockSetVerifiedPrice).not.toHaveBeenCalled();
        expect(mockRecordStationConsensus).not.toHaveBeenCalled();
      });
    });
  });

  // ── getDetail ───────────────────────────────────────────────────────────────

  describe('getDetail', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.getDetail('unknown')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException for non-shadow_rejected submission', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        status: SubmissionStatus.verified,
        station: null,
      });
      await expect(service.getDetail(SUB_ID)).rejects.toThrow(ConflictException);
    });

    it('returns detail for shadow_rejected submission with presigned photo_url', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        station: { name: 'BP Kraków', brand: 'BP' },
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.station_brand).toBe('BP');
      expect(detail.flag_reason).toBe('logo_mismatch');
      expect(detail.photo_url).toBe('https://r2.example.com/presigned');
      expect(mockGetPresignedUrl).toHaveBeenCalledWith('submissions/user/sub.jpg', 3600);
    });

    it('returns null photo_url when photo_r2_key is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ photo_r2_key: null }),
        station: { name: 'BP Kraków', brand: 'BP' },
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.photo_url).toBeNull();
      expect(mockGetPresignedUrl).not.toHaveBeenCalled();
    });

    it('returns null photo_url and logs warn when presigned URL generation fails', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        station: { name: 'BP Kraków', brand: 'BP' },
      });
      mockGetPresignedUrl.mockRejectedValue(new Error('R2 error'));

      const detail = await service.getDetail(SUB_ID);
      expect(detail.photo_url).toBeNull();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    // Story 3.17 — restored_from_submission_id surfaced for user_flagged_wrong rows.

    it('surfaces restored_from_submission_id from USER_FLAGGED_WRONG audit notes', async () => {
      const PRIOR_UUID = '11111111-1111-4111-8111-111111111111';
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: { name: 'BP Kraków', brand: 'BP' },
      });
      mockAuditLogFindFirst.mockResolvedValueOnce({
        notes: JSON.stringify({
          previous_status: 'verified',
          restored_from_submission_id: PRIOR_UUID,
          actor_role: 'DRIVER',
        }),
      });

      const detail = await service.getDetail(SUB_ID);

      expect(detail.restored_from_submission_id).toBe(PRIOR_UUID);
      expect(mockAuditLogFindFirst).toHaveBeenCalledWith({
        where: { submission_id: SUB_ID, action: 'USER_FLAGGED_WRONG' },
        orderBy: { created_at: 'desc' },
        select: { notes: true },
      });
    });

    it('P-1/P-2 — rejects non-UUID restored_from value (open-redirect / log-injection guard)', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: null,
      });
      mockAuditLogFindFirst.mockResolvedValueOnce({
        notes: JSON.stringify({
          restored_from_submission_id: '../other-sub',
        }),
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
    });

    it('P-2 — rejects empty-string restored_from value', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: null,
      });
      mockAuditLogFindFirst.mockResolvedValueOnce({
        notes: JSON.stringify({ restored_from_submission_id: '' }),
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
    });

    it('returns null when audit notes have null restored_from (no prior verified case)', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: null,
      });
      mockAuditLogFindFirst.mockResolvedValueOnce({
        notes: JSON.stringify({
          previous_status: 'verified',
          restored_from_submission_id: null,
        }),
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
    });

    it('returns null when audit row is missing entirely', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: null,
      });
      mockAuditLogFindFirst.mockResolvedValueOnce(null);

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
    });

    it('returns null when audit notes JSON is malformed (defensive)', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'user_flagged_wrong' }),
        station: null,
      });
      mockAuditLogFindFirst.mockResolvedValueOnce({ notes: 'not-valid-json{{{' });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
    });

    it('does NOT query audit log when flag_reason is not user_flagged_wrong', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected({ flag_reason: 'logo_mismatch' }),
        station: null,
      });

      const detail = await service.getDetail(SUB_ID);
      expect(detail.restored_from_submission_id).toBeNull();
      expect(mockAuditLogFindFirst).not.toHaveBeenCalled();
    });
  });

  // ── approve ─────────────────────────────────────────────────────────────────

  describe('approve', () => {
    it('throws NotFoundException when submission does not exist', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already reviewed', async () => {
      mockSubmissionFindUnique.mockResolvedValue({
        ...makeShadowRejected(),
        status: SubmissionStatus.verified,
      });
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
    });

    it('throws BadRequestException when station_id is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected({ station_id: null }));
      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when concurrent admin acts first (updateMany returns 0)', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.approve(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
    });

    it('happy path: updates status, publishes price, clears staleness, writes audit, deletes photo', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.approve(SUB_ID, ADMIN_ID);

      expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: SubmissionStatus.shadow_rejected },
        data: { status: SubmissionStatus.verified, photo_r2_key: null, gps_lat: null, gps_lng: null },
      });
      expect(mockSetVerifiedPrice).toHaveBeenCalledWith(
        STATION_ID,
        expect.objectContaining({
          stationId: STATION_ID,
          prices: { PB_95: 6.5 },
          sources: { PB_95: 'community' },
        }),
      );
      expect(mockStalenessDeleteMany).toHaveBeenCalledWith({
        where: { station_id: STATION_ID, fuel_type: { in: ['PB_95'] } },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: { admin_user_id: ADMIN_ID, action: 'APPROVE', submission_id: SUB_ID, notes: null },
      });
      expect(mockDeleteObject).toHaveBeenCalledWith('submissions/user/sub.jpg');
    });

    it('continues if price service fails (cache self-heals from DB)', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
      mockSetVerifiedPrice.mockRejectedValue(new Error('Redis down'));

      await expect(service.approve(SUB_ID, ADMIN_ID)).resolves.not.toThrow();
      expect(mockAuditLogCreate).toHaveBeenCalled();
    });

    it('logs OPS-ALERT but does not throw if audit log write fails', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });
      mockAuditLogCreate.mockRejectedValue(new Error('DB write failed'));

      await expect(service.approve(SUB_ID, ADMIN_ID)).resolves.not.toThrow();
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('[OPS-ALERT]'),
      );
    });

    it('skips R2 delete when photo_r2_key is null', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected({ photo_r2_key: null }));
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.approve(SUB_ID, ADMIN_ID);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  // ── reject ──────────────────────────────────────────────────────────────────

  describe('reject', () => {
    it('throws NotFoundException when submission does not exist', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);
      await expect(service.reject(SUB_ID, ADMIN_ID, null)).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when concurrent admin acts first', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.reject(SUB_ID, ADMIN_ID, null)).rejects.toThrow(ConflictException);
    });

    it('happy path: updates status, writes audit with notes, keeps photo for cleanup worker', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.reject(SUB_ID, ADMIN_ID, 'Wrong station');

      expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: SubmissionStatus.shadow_rejected },
        data: { status: SubmissionStatus.rejected, gps_lat: null, gps_lng: null },
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          admin_user_id: ADMIN_ID,
          action: 'REJECT',
          submission_id: SUB_ID,
          notes: 'Wrong station',
        },
      });
      // Photo kept for REJECTED_PHOTO_RETENTION_DAYS — cleanup worker handles deletion
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it('does not call setVerifiedPrice on reject', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.reject(SUB_ID, ADMIN_ID, null);
      expect(mockSetVerifiedPrice).not.toHaveBeenCalled();
    });
  });

  // ── requeue ─────────────────────────────────────────────────────────────────

  describe('requeue', () => {
    it('happy path: resets status to pending, re-enqueues, writes audit', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected({ flag_reason: 'low_trust' }));
      mockSubmissionUpdateMany.mockResolvedValue({ count: 1 });

      await service.requeue(SUB_ID, ADMIN_ID);

      expect(mockSubmissionUpdateMany).toHaveBeenCalledWith({
        where: { id: SUB_ID, status: SubmissionStatus.shadow_rejected },
        data: {
          status: SubmissionStatus.pending,
          ocr_confidence_score: null,
          flag_reason: null,
        },
      });
      expect(mockWorkerRequeue).toHaveBeenCalledWith(SUB_ID);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: {
          admin_user_id: ADMIN_ID,
          action: 'REQUEUE',
          submission_id: SUB_ID,
          notes: null,
        },
      });
    });

    it('throws NotFoundException when submission does not exist', async () => {
      mockSubmissionFindUnique.mockResolvedValue(null);

      await expect(service.requeue(SUB_ID, ADMIN_ID)).rejects.toThrow(NotFoundException);
      expect(mockWorkerRequeue).not.toHaveBeenCalled();
    });

    it('throws ConflictException for non-shadow_rejected status', async () => {
      // Prevent accidental re-processing of a verified submission (would
      // republish stale prices) or a rejected one (photo already deleted).
      mockSubmissionFindUnique.mockResolvedValue(
        makeShadowRejected({ status: SubmissionStatus.verified }),
      );

      await expect(service.requeue(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
      expect(mockSubmissionUpdateMany).not.toHaveBeenCalled();
      expect(mockWorkerRequeue).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when photo_r2_key is null', async () => {
      // Photo may have been cleaned up — can't re-run OCR without it.
      mockSubmissionFindUnique.mockResolvedValue(
        makeShadowRejected({ photo_r2_key: null }),
      );

      await expect(service.requeue(SUB_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
      expect(mockWorkerRequeue).not.toHaveBeenCalled();
    });

    it('throws ConflictException when concurrent updateMany changes status first', async () => {
      mockSubmissionFindUnique.mockResolvedValue(makeShadowRejected());
      mockSubmissionUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.requeue(SUB_ID, ADMIN_ID)).rejects.toThrow(ConflictException);
      expect(mockWorkerRequeue).not.toHaveBeenCalled();
    });
  });
});
