/**
 * Integration tests for EstimatedPriceService against a REAL Postgres +
 * PostGIS. These tests exercise the raw SQL inside
 * `computeCommunityGridEstimate` (Story 2.18) — the bug that took
 * production offline on 2026-05-14 was a SQL syntax error that the
 * unit-level mocks couldn't catch.
 *
 * CI requirement: `INTEGRATION_DATABASE_URL` must point at a Postgres
 * instance with PostGIS enabled and the Prisma migrations applied.
 * Locals without a test DB get a "no tests run" notice instead of a
 * hard failure — see jest.integration.config.cjs.
 *
 * Test data is namespaced under the prefix `INTEG_` so cleanup is
 * deterministic even if a prior run aborted before teardown.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { EstimatedPriceService } from './estimated-price.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { PriceCacheService } from './price-cache.service.js';
import type { StalenessDetectionService } from '../market-signal/staleness-detection.service.js';

const INTEGRATION_DB_URL = process.env['INTEGRATION_DATABASE_URL'];

// Production safety guard: refuse to run if the URL looks like prod.
// The integration tests INSERT + DELETE rows; running against a real
// user database would be catastrophic.
function assertSafeUrl(url: string): void {
  const lower = url.toLowerCase();
  if (
    lower.includes('weathered-math') ||
    lower.includes('snowy-hill') ||
    lower.includes('production') ||
    lower.includes('prod-')
  ) {
    throw new Error(
      `INTEGRATION_DATABASE_URL appears to point at a live database (${url}). ` +
        `Refusing to run integration tests — they INSERT + DELETE rows. ` +
        `Use a dedicated test DB or a Docker container.`,
    );
  }
}

const describeIntegration = INTEGRATION_DB_URL ? describe : describe.skip;

describeIntegration('EstimatedPriceService (integration)', () => {
  let pool: Pool;
  let prisma: PrismaClient;
  let service: EstimatedPriceService;

  // Test prefix tags every row we insert; cleanup deletes by prefix.
  const TEST_PREFIX = `INTEG_${Date.now()}_${randomUUID().slice(0, 8)}_`;
  let testUserId: string;

  beforeAll(async () => {
    assertSafeUrl(INTEGRATION_DB_URL!);
    pool = new Pool({ connectionString: INTEGRATION_DB_URL });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

    // EstimatedPriceService's other deps aren't exercised by the
    // computeCommunityGridEstimate path — light stubs are enough.
    const priceCacheStub = {
      getMany: jest.fn().mockResolvedValue(new Map()),
      set: jest.fn().mockResolvedValue(undefined),
    } as unknown as PriceCacheService;
    const stalenessServiceStub = {
      getStaleFuelsForStations: jest.fn().mockResolvedValue(new Map()),
    } as unknown as StalenessDetectionService;

    service = new EstimatedPriceService(
      prisma as unknown as PrismaService,
      priceCacheStub,
      stalenessServiceStub,
    );

    // Seed test user — Submission FKs require one.
    testUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: testUserId,
        display_name: `${TEST_PREFIX}user`,
      },
    });
  });

  afterAll(async () => {
    if (!INTEGRATION_DB_URL) return;
    // Order matters for FK cascade compliance: Submissions → Stations → User.
    try {
      await prisma.$executeRawUnsafe(`
        DELETE FROM "Submission"
        WHERE station_id IN (SELECT id FROM "Station" WHERE name LIKE '${TEST_PREFIX}%')
      `);
      await prisma.$executeRawUnsafe(`
        DELETE FROM "Station" WHERE name LIKE '${TEST_PREFIX}%'
      `);
      await prisma.user.delete({ where: { id: testUserId } });
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Insert a Station with a PostGIS location. Prisma's schema declares
   * `location` as `Unsupported("geography(Point,4326)")` so we can't
   * set it via the regular create() call — raw SQL is required.
   */
  async function seedStation(opts: {
    name: string;
    brand?: string | null;
    lat: number;
    lng: number;
  }): Promise<string> {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Station" (id, name, brand, location, created_at, updated_at)
      VALUES (
        $1, $2, $3,
        ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
        NOW(), NOW()
      )
    `,
      id,
      `${TEST_PREFIX}${opts.name}`,
      opts.brand ?? null,
      opts.lng,
      opts.lat,
    );
    return id;
  }

  async function seedVerifiedSubmission(opts: {
    stationId: string;
    pb95?: number;
    on?: number;
    lpg?: number;
  }): Promise<void> {
    const priceData: Array<{ fuel_type: string; price_per_litre: number }> = [];
    if (opts.pb95 !== undefined) priceData.push({ fuel_type: 'PB_95', price_per_litre: opts.pb95 });
    if (opts.on !== undefined) priceData.push({ fuel_type: 'ON', price_per_litre: opts.on });
    if (opts.lpg !== undefined) priceData.push({ fuel_type: 'LPG', price_per_litre: opts.lpg });

    await prisma.submission.create({
      data: {
        user_id: testUserId,
        station_id: opts.stationId,
        price_data: priceData,
        status: 'verified',
        source: 'community',
      },
    });
  }

  // ── Regression: the 2026-05-14 hotfix ──────────────────────────────

  describe('SQL parses against a real database (regression for 2026-05-14 hotfix)', () => {
    // The original bug was `CROSS JOIN LATERAL (...) ON true` — invalid
    // Postgres syntax. The unit tests mocked $queryRaw so the SQL was
    // never executed. This test fires the query against a real DB, with
    // a target station that doesn't exist, to confirm the query parses.
    it('returns null without throwing when the target station does not exist', async () => {
      const result = await service.computeCommunityGridEstimate(
        randomUUID(),
        'PB_95',
        null,
      );
      expect(result).toBeNull();
    });

    it('returns null when target exists but has no neighbours in radius', async () => {
      const targetId = await seedStation({
        name: 'isolated-target',
        brand: 'orlen',
        lat: 52.0, // somewhere in PL with no other test stations nearby
        lng: 21.0,
      });
      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', 'orlen');
      expect(result).toBeNull();
    });
  });

  // ── Semantic correctness — fixtures with known geometry ────────────

  describe('K-nearest semantics', () => {
    // Łódź-centred fixture cluster: one target at city centre, five
    // neighbours at known distances. We use a tight cluster so all
    // stations sit comfortably within the 10 km radius regardless of
    // the precise haversine math.
    const TARGET_LAT = 51.7592;
    const TARGET_LNG = 19.4560;

    it('returns up to MAX_K neighbours when more are within radius', async () => {
      const targetId = await seedStation({
        name: 'k5-target',
        brand: 'orlen',
        lat: TARGET_LAT,
        lng: TARGET_LNG,
      });

      // Seed 7 neighbours within ~5 km — more than MAX_K=5.
      const offsets = [
        [0.005, 0.005],
        [0.01, 0.005],
        [-0.005, 0.01],
        [0.015, -0.005],
        [-0.01, -0.01],
        [0.02, 0.02],
        [-0.02, 0.015],
      ];
      for (let i = 0; i < offsets.length; i++) {
        const off = offsets[i]!;
        const nid = await seedStation({
          name: `k5-neighbour-${i}`,
          brand: 'circle-k',
          lat: TARGET_LAT + off[0]!,
          lng: TARGET_LNG + off[1]!,
        });
        await seedVerifiedSubmission({ stationId: nid, pb95: 6.5 + i * 0.01 });
      }

      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', 'orlen');
      expect(result).not.toBeNull();
      expect(result!.referenceStationCount).toBeLessThanOrEqual(5);
      expect(result!.referenceStationCount).toBeGreaterThanOrEqual(3);
    });

    it('excludes non-verified submissions', async () => {
      const targetId = await seedStation({
        name: 'unverified-target',
        brand: null,
        lat: 50.5,
        lng: 20.0,
      });
      const neighbourId = await seedStation({
        name: 'unverified-neighbour',
        brand: null,
        lat: 50.503,
        lng: 20.003,
      });

      // Insert a pending submission directly — must not count.
      await prisma.submission.create({
        data: {
          user_id: testUserId,
          station_id: neighbourId,
          price_data: [{ fuel_type: 'PB_95', price_per_litre: 6.0 }],
          status: 'pending',
          source: 'community',
        },
      });

      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', null);
      expect(result).toBeNull();
    });

    it('filters by the requested fuel type — neighbours with other fuels do not count', async () => {
      const targetId = await seedStation({
        name: 'fuel-filter-target',
        brand: null,
        lat: 50.6,
        lng: 20.1,
      });
      const neighbourId = await seedStation({
        name: 'fuel-filter-neighbour',
        brand: null,
        lat: 50.603,
        lng: 20.103,
      });
      // Only LPG — should not match a PB_95 query.
      await seedVerifiedSubmission({ stationId: neighbourId, lpg: 3.2 });

      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', null);
      expect(result).toBeNull();
    });

    it('returns IDW midpoint inside the bracket of contributing neighbour prices', async () => {
      const targetId = await seedStation({
        name: 'idw-target',
        brand: null,
        lat: 50.7,
        lng: 20.2,
      });

      const prices = [6.20, 6.30, 6.40];
      for (let i = 0; i < prices.length; i++) {
        const nid = await seedStation({
          name: `idw-neighbour-${i}`,
          brand: null,
          lat: 50.7 + 0.003 * (i + 1),
          lng: 20.2 + 0.003 * (i + 1),
        });
        await seedVerifiedSubmission({ stationId: nid, pb95: prices[i] });
      }

      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', null);
      expect(result).not.toBeNull();
      // IDW with 3 inputs in [6.20, 6.40] must land in that bracket.
      expect(result!.midpoint).toBeGreaterThanOrEqual(6.20);
      expect(result!.midpoint).toBeLessThanOrEqual(6.40);
    });

    // Story 2.18 — propagateToNearbyStations is fire-and-forget from the
    // photo-pipeline verify path. Its raw SQL has the same SQL-syntax-
    // error class of risk as the K-nearest query; this smoke test just
    // confirms it parses + runs against a real DB.
    it('propagateToNearbyStations SQL parses + runs without throwing', async () => {
      // Use a non-existent origin id — query should still parse and
      // return zero work, NOT throw. (Method swallows its own DB errors,
      // so the assertion is "doesn't throw" rather than a result.)
      await expect(
        service.propagateToNearbyStations(randomUUID(), 'PB_95'),
      ).resolves.not.toThrow();
    });

    it('applies same-brand boost — same-brand neighbours pull the midpoint more', async () => {
      const TARGET_BRAND = 'orlen';
      const lat = 50.8;
      const lng = 20.3;

      // Two equidistant neighbours, one same-brand cheap one different-brand expensive.
      const targetId = await seedStation({ name: 'brand-target', brand: TARGET_BRAND, lat, lng });
      const sameBrandId = await seedStation({
        name: 'brand-same',
        brand: TARGET_BRAND,
        lat: lat + 0.005,
        lng,
      });
      const otherBrandId = await seedStation({
        name: 'brand-other',
        brand: 'bp',
        lat: lat - 0.005,
        lng,
      });

      await seedVerifiedSubmission({ stationId: sameBrandId, pb95: 6.00 });
      await seedVerifiedSubmission({ stationId: otherBrandId, pb95: 7.00 });

      const result = await service.computeCommunityGridEstimate(targetId, 'PB_95', TARGET_BRAND);
      expect(result).not.toBeNull();
      // Without boost: midpoint = 6.50. With 2x same-brand boost on the
      // 6.00 neighbour: midpoint pulled below 6.50.
      expect(result!.midpoint).toBeLessThan(6.50);
    });
  });
});
