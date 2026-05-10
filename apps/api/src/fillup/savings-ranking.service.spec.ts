import { Test, TestingModule } from '@nestjs/testing';
import { SavingsRankingService } from './savings-ranking.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockQueryRaw = jest.fn();
const mockPrisma = { $queryRaw: mockQueryRaw };

const USER_ID = 'user-A';
const MONTH_START = new Date(Date.UTC(2026, 2, 1));   // 2026-03-01
const MONTH_END = new Date(Date.UTC(2026, 3, 1));     // 2026-04-01

describe('SavingsRankingService', () => {
  let service: SavingsRankingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQueryRaw.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SavingsRankingService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(SavingsRankingService);
  });

  // ── getUserPercentile ──────────────────────────────────────────────────────

  describe('getUserPercentile', () => {
    it('returns null when SQL returns no rows (user not in cohort or no voivodeship)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result).toBeNull();
    });

    it('returns null when cohort is below threshold (privacy floor)', async () => {
      // 9 drivers — one short of the COHORT_THRESHOLD = 10. The CTE
      // would still emit a row (`getUserPercentile` filters at the
      // service layer, not in SQL, so the same SQL result is reusable
      // by the bulk path).
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 3, total_drivers: 9, total_savings_pln: 60, best_saver_pln: 200 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result).toBeNull();
    });

    it('returns top 10% for rank 1 of 10 (Math.max guards against "top 0%")', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        // Rank 1 → viewer IS the max → bestSaver leak-guarded to null.
        { user_id: USER_ID, rank: 1, total_drivers: 10, total_savings_pln: 247.6, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      // 1/10 = 0.10 → 10. Math.max(1, …) is a guard for the rank=0
      // edge case (impossible from RANK() but defensive).
      expect(result).toEqual({ topPercent: 10, bestSaverSavingsPln: null });
    });

    it('returns top 50% for the median driver in a 10-driver cohort', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 5, total_drivers: 10, total_savings_pln: 100, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      // bestSaver rounds 247.6 → 248 (no grosz precision in shareable amount).
      expect(result).toEqual({ topPercent: 50, bestSaverSavingsPln: 248 });
    });

    it('returns top 100% for the bottom driver in a 10-driver cohort', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 10, total_drivers: 10, total_savings_pln: 5, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result).toEqual({ topPercent: 100, bestSaverSavingsPln: 248 });
    });

    it('handles rank/total combos that round to values 1–100', async () => {
      // 23rd of 100 = 23%
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 23, total_drivers: 100, total_savings_pln: 50, best_saver_pln: 500 },
      ]);
      expect(await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END)).toEqual({
        topPercent: 23,
        bestSaverSavingsPln: 500,
      });
    });

    it('SQL filters out soft-deleted users in EVERY CTE (defence-in-depth)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // 3 CTEs touch FillUp + User: user_voivodeship, cohort_users
      // (inner mrv subquery), and savings. All three must apply the
      // soft-delete filter so a deleted user can't anchor cohort
      // selection or inflate cohort size.
      const userJoinCount = (fullSql.match(/JOIN "User"/g) ?? []).length;
      const deletedAtCount = (fullSql.match(/u\.deleted_at IS NULL/g) ?? []).length;
      expect(userJoinCount).toBeGreaterThanOrEqual(3);
      expect(deletedAtCount).toBeGreaterThanOrEqual(3);
    });

    it('SQL HAVING clause excludes zero/negative-savings users from cohort', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // Both the SUM expression and the HAVING > 0 are essential for AC1
      expect(fullSql).toContain('HAVING');
      expect(fullSql).toContain('> 0');
    });

    it("uses the user's most-recent fillup voivodeship as cohort scope (not all voivodeships)", async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      expect(fullSql).toContain('user_voivodeship');
      expect(fullSql).toContain('cohort_users');
      expect(fullSql).toContain('ORDER BY f.filled_at DESC');
    });

    it('cohort_users computes most-recent voivodeship FIRST, then filters (not direct WHERE)', async () => {
      // Without this, a multi-voivodeship commuter whose most-recent
      // fillup is in voivodeship Y but who also fuelled in X would be
      // included in X's cohort — yielding a different rank from the
      // bulk path. Catches regression of the BLOCKER from 5.8 review.
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // The MRV-then-filter pattern uses an inner subquery `mrv` whose
      // WHERE is at the OUTER level — not inline in the inner CTE.
      expect(fullSql).toMatch(/FROM\s*\(\s*SELECT DISTINCT ON \(f\.user_id\)/);
      expect(fullSql).toMatch(/\)\s*mrv/);
      expect(fullSql).toContain('mrv.voivodeship = (SELECT voivodeship FROM user_voivodeship)');
    });

    it('savings CTE uses grosz-integer math (matches FillupService.getMonthlySummary)', async () => {
      // Without this, a user with raw-positive but rounded-zero savings
      // could be inconsistently in/out of the cohort vs their visible
      // totalSavingsPln — float drift between two definitions of
      // "positive savings" is the failure mode.
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      expect(fullSql).toContain('ROUND');
      expect(fullSql).toContain('numeric');
    });

    it('RANK() uses deterministic tiebreaker by user_id (defends ceiling guard)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // Without the user_id tiebreaker, ties produce gaps: 3 users tied
      // at rank 1 → next user gets rank 4. Combined with `RANK() > total_drivers`
      // for the bottom-tied driver, percentile could exceed 100.
      expect(fullSql).toContain('ORDER BY total_savings_pln DESC, user_id');
    });

    it('caps topPercent at 100 even when raw rank/total math overshoots (defence-in-depth)', async () => {
      // Concrete shape of the defence: even if a future SQL change
      // re-introduces ties without the tiebreaker, percent_rank() would
      // still produce ≤ 100. The `Math.min(100, …)` is a belt-and-
      // suspenders cap.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 11, total_drivers: 10, total_savings_pln: 5, best_saver_pln: 200 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.topPercent).toBeLessThanOrEqual(100);
      expect(result?.topPercent).toBe(100);
    });

    it('coerces bigint rank/total_drivers to number (defensive against future driver behaviour)', async () => {
      // Postgres ::int cast usually yields number, but Neon driver or
      // future Prisma versions could return bigint for COUNT(). Mixed-
      // type division throws TypeError. The Number() coercion in the
      // service guards against this.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: BigInt(2), total_drivers: BigInt(20), total_savings_pln: 80, best_saver_pln: 250 },
      ]);

      // Should not throw; should round 2/20 = 0.1 → 10
      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result).toEqual({ topPercent: 10, bestSaverSavingsPln: 250 });
    });

    // ── Story 5.9 leak guard ────────────────────────────────────────────────

    it('Story 5.9 — suppresses bestSaver when viewer IS the cohort max', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        // Viewer's own savings == cohort max → leak guard fires.
        // Without this the recipient could infer the viewer's exact
        // savings from "Best in your area: 247 PLN" on the share card.
        { user_id: USER_ID, rank: 1, total_drivers: 12, total_savings_pln: 247.6, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.topPercent).toBe(8); // 1/12 = 0.083 → 8
      expect(result?.bestSaverSavingsPln).toBeNull();
    });

    it('Story 5.9 — suppresses bestSaver when viewer is tied for the max (>= comparison)', async () => {
      // Two-way tie at top. Both tied users hit the leak guard so
      // neither sees the exact figure they could have inferred from
      // their own savings.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 1, total_drivers: 15, total_savings_pln: 312.0, best_saver_pln: 312.0 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.bestSaverSavingsPln).toBeNull();
    });

    it('Story 5.9 — bestSaver populated when viewer is below the max', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 4, total_drivers: 15, total_savings_pln: 180, best_saver_pln: 312.0 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      // Rounded to integer PLN — no grosz precision in the publicly-
      // visible aggregate.
      expect(result?.bestSaverSavingsPln).toBe(312);
    });

    it('Story 5.9 — bestSaver rounds 247.6 → 248 (no grosz precision leak)', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 5, total_drivers: 15, total_savings_pln: 100, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.bestSaverSavingsPln).toBe(248);
    });

    it('Story 5.9 — leak guard fires when viewer is within 0.5 PLN of max (near-max inference)', async () => {
      // Viewer at 247.49, max at 247.6 → within the 0.5 PLN buffer.
      // Without the buffer: viewer's card shows "Saved 247.49 PLN",
      // bestSaver shows "248 PLN" — recipient infers viewer is rank
      // 1 or near-tied, narrowing viewer's standing precisely.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 2, total_drivers: 12, total_savings_pln: 247.49, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.topPercent).toBe(17); // 2/12 = 0.167 → 17
      expect(result?.bestSaverSavingsPln).toBeNull();
    });

    it('Story 5.9 — leak guard does NOT fire when viewer is more than 0.5 PLN below max', async () => {
      // Viewer at 247, max at 247.6 → 247 < 247.1 (max - 0.5) → guard
      // does NOT fire. Recipient seeing "Saved 247.00 PLN" + "best 248"
      // can't easily infer how close to max the viewer was; ~1 PLN gap
      // doesn't trivially identify rank.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 4, total_drivers: 15, total_savings_pln: 247.00, best_saver_pln: 247.6 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.bestSaverSavingsPln).toBe(248);
    });

    it('Story 5.9 — fail-CLOSED on NaN inputs (privacy guard default)', async () => {
      // If a future SQL refactor drops total_savings_pln from SELECT,
      // Number(undefined) → NaN. The guard MUST suppress, not return
      // the cohort max. NaN >= NaN is always false, so a naive `>=`
      // check would fail open and ship the bestSaver value.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 5, total_drivers: 15, total_savings_pln: undefined, best_saver_pln: 312 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      // Cohort + percentile populated; bestSaver suppressed by NaN guard.
      expect(result?.topPercent).toBe(33);
      expect(result?.bestSaverSavingsPln).toBeNull();
    });

    it('Story 5.9 — all users tied at cohort max → bestSaver suppressed for everyone (locked-in design)', async () => {
      // Edge case: every user in cohort has identical total_savings.
      // Each viewer is "the max" → leak guard fires for all. Nobody
      // sees the line. Spec doesn't address this; the test pins the
      // current behaviour so a future change is intentional.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 1, total_drivers: 11, total_savings_pln: 100, best_saver_pln: 100 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result?.topPercent).toBe(9);
      expect(result?.bestSaverSavingsPln).toBeNull();
    });

    it('Story 5.9 AC7 — null bestSaver when cohort threshold not met (parent returns null)', async () => {
      // The parent `result === null` path is the strongest "no
      // bestSaver" signal — when there's no percentile, there's no
      // bestSaver either. This test pins the contract: a single null
      // is the only way to communicate "no cohort data."
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: USER_ID, rank: 1, total_drivers: 5, total_savings_pln: 50, best_saver_pln: 200 },
      ]);

      const result = await service.getUserPercentile(USER_ID, MONTH_START, MONTH_END);

      expect(result).toBeNull();
    });
  });

  // ── getBulkPercentilesForMonth ─────────────────────────────────────────────

  describe('getBulkPercentilesForMonth', () => {
    it('returns an empty Map when SQL returns no rows', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      const result = await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('returns a Map keyed by user_id with computed percentiles', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        // user-A is rank 1 within their cohort → leak-guarded.
        { user_id: 'user-A', rank: 1, total_drivers: 10, total_savings_pln: 312, best_saver_pln: 312 },
        // user-B is mid-cohort → bestSaver populated.
        { user_id: 'user-B', rank: 5, total_drivers: 10, total_savings_pln: 80, best_saver_pln: 312 },
        // user-C is in a different cohort with its own max.
        { user_id: 'user-C', rank: 1, total_drivers: 20, total_savings_pln: 500, best_saver_pln: 500 },
      ]);

      const result = await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      // user-A is the cohort max → leak guard nulls bestSaver
      expect(result.get('user-A')).toEqual({ topPercent: 10, bestSaverSavingsPln: null });
      expect(result.get('user-B')).toEqual({ topPercent: 50, bestSaverSavingsPln: 312 });
      // user-C: 1/20 = 0.05 → 5; also leak-guarded (rank 1 in their cohort)
      expect(result.get('user-C')).toEqual({ topPercent: 5, bestSaverSavingsPln: null });
    });

    it('SQL applies the cohort threshold inline (privacy floor enforced at SQL)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // The bulk query filters cohorts below the threshold in SQL so the
      // 6.5 caller doesn't have to re-filter the map. The single-user
      // path filters at the service layer (one row only, cheap).
      expect(fullSql).toContain('total_drivers >=');
    });

    it('partitions ranking by voivodeship (not global)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      expect(fullSql).toContain('PARTITION BY voivodeship');
    });

    it('SQL filters out soft-deleted users in EVERY CTE (defence-in-depth)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      // 2 CTEs touch FillUp + User: most_recent_voivodeship and savings.
      const userJoinCount = (fullSql.match(/JOIN "User"/g) ?? []).length;
      const deletedAtCount = (fullSql.match(/u\.deleted_at IS NULL/g) ?? []).length;
      expect(userJoinCount).toBeGreaterThanOrEqual(2);
      expect(deletedAtCount).toBeGreaterThanOrEqual(2);
    });

    it('uses grosz-integer math + deterministic tiebreaker (matches single-user semantics)', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);

      await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      const [sqlArg] = mockQueryRaw.mock.calls[0] as [{ strings?: readonly string[] }];
      const fullSql = (sqlArg.strings ?? []).join('');
      expect(fullSql).toContain('ROUND');
      // Tiebreaker by user_id (matches single-user path) — guarantees
      // both endpoints return the same percentile for the same user.
      expect(fullSql).toContain('ORDER BY total_savings_pln DESC, user_id');
    });

    it('coerces bigint rank/total_drivers to number per row', async () => {
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: 'user-A', rank: BigInt(1), total_drivers: BigInt(10), total_savings_pln: 250, best_saver_pln: 250 },
        { user_id: 'user-B', rank: BigInt(5), total_drivers: BigInt(10), total_savings_pln: 80, best_saver_pln: 250 },
      ]);

      const result = await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      // user-A: leak-guarded; user-B: populated.
      expect(result.get('user-A')).toEqual({ topPercent: 10, bestSaverSavingsPln: null });
      expect(result.get('user-B')).toEqual({ topPercent: 50, bestSaverSavingsPln: 250 });
    });

    it('Story 5.9 — bulk path applies leak guard per row independently', async () => {
      // Three users in the same cohort: user-A is the max (leak-
      // guarded), user-B and user-C see the populated value. Critical
      // that the per-row guard fires for the cohort top, NOT for the
      // overall query top.
      mockQueryRaw.mockResolvedValueOnce([
        { user_id: 'user-A', rank: 1, total_drivers: 10, total_savings_pln: 400, best_saver_pln: 400 },
        { user_id: 'user-B', rank: 3, total_drivers: 10, total_savings_pln: 250, best_saver_pln: 400 },
        { user_id: 'user-C', rank: 7, total_drivers: 10, total_savings_pln: 60, best_saver_pln: 400 },
      ]);

      const result = await service.getBulkPercentilesForMonth(MONTH_START, MONTH_END);

      expect(result.get('user-A')?.bestSaverSavingsPln).toBeNull();
      expect(result.get('user-B')?.bestSaverSavingsPln).toBe(400);
      expect(result.get('user-C')?.bestSaverSavingsPln).toBe(400);
    });
  });
});
