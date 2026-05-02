import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OdometerService } from './odometer.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockVehicleFindUnique = jest.fn();
const mockReadingFindFirst = jest.fn();
const mockReadingFindUniqueOrThrow = jest.fn();
const mockReadingCreate = jest.fn();
const mockReadingUpdate = jest.fn();
const mockReadingFindMany = jest.fn();
const mockReadingCount = jest.fn();
const mockFillupFindUnique = jest.fn();
const mockFillupFindFirst = jest.fn();
const mockFillupFindMany = jest.fn();
const mockFillupUpdate = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  vehicle: { findUnique: mockVehicleFindUnique },
  odometerReading: {
    findFirst: mockReadingFindFirst,
    findUnique: jest.fn(),
    findUniqueOrThrow: mockReadingFindUniqueOrThrow,
    create: mockReadingCreate,
    update: mockReadingUpdate,
    findMany: mockReadingFindMany,
    count: mockReadingCount,
  },
  fillUp: {
    findUnique: mockFillupFindUnique,
    findFirst: mockFillupFindFirst,
    findMany: mockFillupFindMany,
    update: mockFillupUpdate,
  },
  $transaction: mockTransaction,
};

const USER_ID = 'user-A';
const OTHER_USER_ID = 'user-B';
const VEHICLE_ID = 'veh-1';
const READING_ID = 'odo-1';
const FILLUP_ID = 'fu-1';

function makeVehicle(overrides: Partial<{ id: string; user_id: string }> = {}) {
  return { id: VEHICLE_ID, user_id: USER_ID, ...overrides };
}

function makeReading(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: READING_ID,
    user_id: USER_ID,
    vehicle_id: VEHICLE_ID,
    fillup_id: null,
    km: 100000,
    recorded_at: new Date('2026-05-02T10:00:00.000Z'),
    created_at: new Date('2026-05-02T10:00:00.000Z'),
    ...overrides,
  };
}

function baseDto(overrides: Partial<{ km: number; vehicleId: string; fillupId?: string; recordedAt?: string }> = {}) {
  return {
    vehicleId: VEHICLE_ID,
    km: 100100,
    ...overrides,
  };
}

describe('OdometerService', () => {
  let service: OdometerService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: create returns a reading with the data echoed back so the
    // calling code can read .id off the result.
    mockReadingCreate.mockImplementation(({ data }) =>
      Promise.resolve(makeReading({ ...data, id: READING_ID })),
    );
    // findUniqueOrThrow used by calculateConsumption to refetch the new
    // reading for its recorded_at — return whatever the create just made.
    mockReadingFindUniqueOrThrow.mockImplementation(({ where }) =>
      Promise.resolve(makeReading({ id: where.id, km: 100100 })),
    );
    // Default: $transaction takes an array of promises and resolves them.
    mockTransaction.mockImplementation((ops) => Promise.all(ops));
    mockReadingUpdate.mockResolvedValue({});
    mockFillupUpdate.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OdometerService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OdometerService>(OdometerService);
  });

  // ── Vehicle ownership ───────────────────────────────────────────────────

  describe('createReading — vehicle ownership', () => {
    it('throws NotFound when the vehicle does not exist', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(null);

      await expect(service.createReading(USER_ID, baseDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockReadingCreate).not.toHaveBeenCalled();
    });

    it('throws Forbidden when the vehicle belongs to another user', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle({ user_id: OTHER_USER_ID }));

      await expect(service.createReading(USER_ID, baseDto())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mockReadingCreate).not.toHaveBeenCalled();
    });
  });

  // ── AC3: baseline (first reading) ───────────────────────────────────────

  describe('createReading — first reading (AC3 baseline)', () => {
    it('saves as baseline and returns consumption: null', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null); // no previous reading
      mockFillupFindFirst.mockResolvedValueOnce(null); // no recent fill-up to auto-link

      const result = await service.createReading(USER_ID, baseDto({ km: 50000 }));

      expect(mockReadingCreate).toHaveBeenCalled();
      expect(result.consumption).toBeNull();
    });
  });

  // ── AC6: negative / zero delta ──────────────────────────────────────────

  describe('createReading — negative delta (AC6)', () => {
    it('throws 422 NEGATIVE_DELTA when new km equals previous', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(makeReading({ km: 100100 }));

      await expect(
        service.createReading(USER_ID, baseDto({ km: 100100 })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mockReadingCreate).not.toHaveBeenCalled();
    });

    it('throws 422 NEGATIVE_DELTA when new km is below previous', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(makeReading({ km: 100100 }));

      await expect(
        service.createReading(USER_ID, baseDto({ km: 99000 })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('includes previousKm in the error response for the mobile client', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(makeReading({ km: 87450 }));

      try {
        await service.createReading(USER_ID, baseDto({ km: 87000 }));
        fail('Expected UnprocessableEntityException');
      } catch (e) {
        const err = e as UnprocessableEntityException;
        const response = err.getResponse() as Record<string, unknown>;
        expect(response['error']).toBe('NEGATIVE_DELTA');
        expect(response['previousKm']).toBe(87450);
      }
    });
  });

  // ── AC4: consumption calculation ────────────────────────────────────────

  describe('createReading — consumption calculation (AC4)', () => {
    it('computes l/100km from a single fill-up in the segment', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      // Previous reading at 100,000 km
      mockReadingFindFirst.mockResolvedValueOnce(
        makeReading({ km: 100000, recorded_at: new Date('2026-05-01T10:00:00.000Z') }),
      );
      mockFillupFindFirst.mockResolvedValueOnce(null); // no auto-link
      // New reading at 100,500 (500km delta) — created with km: 100500 below
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(
        makeReading({ id: READING_ID, km: 100500, recorded_at: new Date('2026-05-02T10:00:00.000Z') }),
      );
      // Single fill-up of 35.5 L in the segment
      mockFillupFindMany.mockResolvedValueOnce([
        { id: FILLUP_ID, litres: 35.5 },
      ]);
      // Final re-fetch after create
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(makeReading({ km: 100500 }));

      const result = await service.createReading(USER_ID, baseDto({ km: 100500 }));

      // 35.5 L / 500 km × 100 = 7.1 L/100km
      expect(result.consumption).toEqual({
        consumptionL100km: 7.1,
        kmDelta: 500,
        litresInSegment: 35.5,
      });
      // And it should have been written back to the most recent fill-up
      expect(mockFillupUpdate).toHaveBeenCalledWith({
        where: { id: FILLUP_ID },
        data: { consumption_l_per_100km: 7.1 },
      });
    });

    it('sums litres from multiple fill-ups across the segment', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(
        makeReading({ km: 100000, recorded_at: new Date('2026-05-01T10:00:00.000Z') }),
      );
      mockFillupFindFirst.mockResolvedValueOnce(null);
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(
        makeReading({ id: READING_ID, km: 101000, recorded_at: new Date('2026-05-10T10:00:00.000Z') }),
      );
      mockFillupFindMany.mockResolvedValueOnce([
        { id: 'fu-most-recent', litres: 30 },
        { id: 'fu-mid', litres: 25 },
        { id: 'fu-old', litres: 20 },
      ]);
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(makeReading({ km: 101000 }));

      const result = await service.createReading(USER_ID, baseDto({ km: 101000 }));

      // (30+25+20) / 1000 × 100 = 7.5 L/100km
      expect(result.consumption?.consumptionL100km).toBe(7.5);
      expect(result.consumption?.kmDelta).toBe(1000);
      expect(result.consumption?.litresInSegment).toBe(75);
      // Stored on the MOST RECENT fill-up in the segment.
      expect(mockFillupUpdate).toHaveBeenCalledWith({
        where: { id: 'fu-most-recent' },
        data: { consumption_l_per_100km: 7.5 },
      });
    });

    it('rounds consumption to 1 decimal place', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(
        makeReading({ km: 100000, recorded_at: new Date('2026-05-01T10:00:00.000Z') }),
      );
      mockFillupFindFirst.mockResolvedValueOnce(null);
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(
        makeReading({ id: READING_ID, km: 100333, recorded_at: new Date('2026-05-02T10:00:00.000Z') }),
      );
      mockFillupFindMany.mockResolvedValueOnce([{ id: FILLUP_ID, litres: 23.7 }]);
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(makeReading({ km: 100333 }));

      const result = await service.createReading(USER_ID, baseDto({ km: 100333 }));

      // 23.7 / 333 × 100 = 7.117117... → rounded to 7.1
      expect(result.consumption?.consumptionL100km).toBe(7.1);
    });
  });

  // ── AC5: no fill-ups in segment ─────────────────────────────────────────

  describe('createReading — no fill-ups in segment (AC5)', () => {
    it('returns consumption with consumptionL100km: null + retains kmDelta', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(
        makeReading({ km: 100000, recorded_at: new Date('2026-05-01T10:00:00.000Z') }),
      );
      mockFillupFindFirst.mockResolvedValueOnce(null);
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(
        makeReading({ id: READING_ID, km: 100250, recorded_at: new Date('2026-05-02T10:00:00.000Z') }),
      );
      mockFillupFindMany.mockResolvedValueOnce([]); // no fill-ups
      mockReadingFindUniqueOrThrow.mockResolvedValueOnce(makeReading({ km: 100250 }));

      const result = await service.createReading(USER_ID, baseDto({ km: 100250 }));

      expect(result.consumption).toEqual({
        consumptionL100km: null,
        kmDelta: 250,
        litresInSegment: null,
      });
      // No FillUp.update should fire when there are no fill-ups in segment.
      expect(mockFillupUpdate).not.toHaveBeenCalled();
    });
  });

  // ── AC7: auto-link to fill-up within 30 minutes ─────────────────────────

  describe('createReading — auto-link (AC7)', () => {
    it('auto-links to a fill-up within 30 min when no explicit fillupId', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null); // first reading → baseline
      mockFillupFindFirst.mockResolvedValueOnce({ id: FILLUP_ID }); // recent fill-up

      await service.createReading(USER_ID, baseDto({ km: 50000 }));

      // The auto-link transaction should have been invoked — both the
      // reading.update (set fillup_id) and the fillUp.update
      // (set odometer_km) run together.
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('uses the explicit fillupId when provided AND verifies ownership + already-linked', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null);
      mockFillupFindUnique.mockResolvedValueOnce({
        id: FILLUP_ID,
        user_id: USER_ID,
        vehicle_id: VEHICLE_ID,
        odometerReading: null,
      });

      await service.createReading(USER_ID, baseDto({ km: 50000, fillupId: FILLUP_ID }));

      // Auto-link findFirst is NOT consulted — explicit link wins.
      expect(mockFillupFindFirst).not.toHaveBeenCalled();
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    it('does NOT auto-link when no fill-up matches the 30-min window', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null);
      mockFillupFindFirst.mockResolvedValueOnce(null); // nothing in window

      await service.createReading(USER_ID, baseDto({ km: 50000 }));

      // No transaction (no link) — but the reading still saved
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReadingCreate).toHaveBeenCalled();
    });

    it('skips the explicit link silently when the target fill-up belongs to another user', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null);
      mockFillupFindUnique.mockResolvedValueOnce({
        id: FILLUP_ID,
        user_id: OTHER_USER_ID,
        vehicle_id: VEHICLE_ID,
        odometerReading: null,
      });

      await service.createReading(USER_ID, baseDto({ km: 50000, fillupId: FILLUP_ID }));

      // Reading saved as standalone — link refused but no exception
      // (the user might mis-construct the call; reading itself is valid).
      expect(mockReadingCreate).toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('skips the explicit link when target fill-up already has a reading', async () => {
      mockVehicleFindUnique.mockResolvedValueOnce(makeVehicle());
      mockReadingFindFirst.mockResolvedValueOnce(null);
      mockFillupFindUnique.mockResolvedValueOnce({
        id: FILLUP_ID,
        user_id: USER_ID,
        vehicle_id: VEHICLE_ID,
        odometerReading: { id: 'existing-reading' },
      });

      await service.createReading(USER_ID, baseDto({ km: 50000, fillupId: FILLUP_ID }));

      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  // ── listReadings ────────────────────────────────────────────────────────

  describe('listReadings', () => {
    it('paginates newest-first scoped to the user', async () => {
      mockReadingFindMany.mockResolvedValueOnce([{ id: 'r2' }, { id: 'r1' }]);
      mockReadingCount.mockResolvedValueOnce(2);

      const result = await service.listReadings(USER_ID, undefined, 1, 20);

      expect(mockReadingFindMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        orderBy: { recorded_at: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.total).toBe(2);
    });

    it('filters by vehicleId when provided', async () => {
      mockReadingFindMany.mockResolvedValueOnce([]);
      mockReadingCount.mockResolvedValueOnce(0);

      await service.listReadings(USER_ID, VEHICLE_ID, 1, 20);

      expect(mockReadingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: USER_ID, vehicle_id: VEHICLE_ID },
        }),
      );
    });

    it('clamps page below 1 and limit above 100', async () => {
      mockReadingFindMany.mockResolvedValueOnce([]);
      mockReadingCount.mockResolvedValueOnce(0);

      await service.listReadings(USER_ID, undefined, -3, 9999);

      expect(mockReadingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });
});
