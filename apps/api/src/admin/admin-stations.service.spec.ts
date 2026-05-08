import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminStationsService } from './admin-stations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PriceCacheService } from '../price/price-cache.service.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockStationFindMany = jest.fn();
const mockStationCount = jest.fn();
const mockStationFindUnique = jest.fn();
const mockPriceHistoryCreate = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockQueryRaw = jest.fn();

const mockTransaction = jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));

const mockStationUpdate = jest.fn();

const mockPrisma = {
  station: {
    findMany: mockStationFindMany,
    count: mockStationCount,
    findUnique: mockStationFindUnique,
    update: mockStationUpdate,
  },
  priceHistory: {
    create: mockPriceHistoryCreate,
  },
  adminAuditLog: {
    create: mockAuditLogCreate,
  },
  $queryRaw: mockQueryRaw,
  $transaction: mockTransaction,
};

const mockCacheInvalidate = jest.fn();

const mockPriceCache = {
  invalidate: mockCacheInvalidate,
};

const STATION_ID = 'station-uuid-1';
const ADMIN_ID = 'admin-uuid-1';

const makeStation = (overrides = {}) => ({
  id: STATION_ID,
  name: 'Test Station',
  address: 'ul. Testowa 1',
  brand: 'Orlen',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminStationsService', () => {
  let service: AdminStationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    mockAuditLogCreate.mockResolvedValue({});
    mockCacheInvalidate.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminStationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PriceCacheService, useValue: mockPriceCache },
      ],
    }).compile();

    service = module.get(AdminStationsService);
  });

  // ── searchStations ───────────────────────────────────────────────────────────

  describe('searchStations', () => {
    it('returns paginated results', async () => {
      const stations = [makeStation()];
      mockStationFindMany.mockResolvedValue(stations);
      mockStationCount.mockResolvedValue(1);

      const result = await service.searchStations('Test', 1, 20);

      expect(result.data).toEqual(stations);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(mockStationFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('returns empty results when none match', async () => {
      mockStationFindMany.mockResolvedValue([]);
      mockStationCount.mockResolvedValue(0);

      const result = await service.searchStations('no-match', 1, 20);

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ── getStationDetail ─────────────────────────────────────────────────────────

  describe('getStationDetail', () => {
    it('throws NotFoundException for unknown station ID', async () => {
      mockStationFindUnique.mockResolvedValue(null);

      await expect(service.getStationDetail('unknown-id')).rejects.toThrow(NotFoundException);
    });

    it('returns station with prices (most recent per fuel type)', async () => {
      const station = makeStation();
      const priceRows = [
        { fuel_type: 'PB_95', price: 6.5, source: 'community', recorded_at: new Date() },
        { fuel_type: 'ON', price: 6.2, source: 'admin_override', recorded_at: new Date() },
      ];
      mockStationFindUnique.mockResolvedValue(station);
      mockQueryRaw.mockResolvedValue(priceRows);

      const result = await service.getStationDetail(STATION_ID);

      expect(result.id).toBe(STATION_ID);
      expect(result.name).toBe('Test Station');
      expect(result.prices).toEqual(priceRows);
    });
  });

  // ── overridePrice ────────────────────────────────────────────────────────────

  describe('overridePrice', () => {
    it('throws NotFoundException for unknown station', async () => {
      mockStationFindUnique.mockResolvedValue(null);

      await expect(
        service.overridePrice('unknown-id', 'PB_95', 6.5, 'correction', ADMIN_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates PriceHistory + audit in one transaction, then invalidates cache', async () => {
      mockStationFindUnique.mockResolvedValue({ id: STATION_ID });
      mockPriceHistoryCreate.mockResolvedValue({});

      await service.overridePrice(STATION_ID, 'PB_95', 6.5, 'price correction', ADMIN_ID);

      expect(mockTransaction).toHaveBeenCalledTimes(1);

      expect(mockPriceHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          station_id: STATION_ID,
          fuel_type: 'PB_95',
          price: 6.5,
          source: 'admin_override',
        }),
      });

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: ADMIN_ID,
          action: 'PRICE_OVERRIDE',
          submission_id: null,
          notes: expect.stringContaining('price correction'),
        }),
      });

      expect(mockCacheInvalidate).toHaveBeenCalledWith(STATION_ID);
    });

    it('still invalidates cache even if transaction succeeds (fail-open on cache)', async () => {
      mockStationFindUnique.mockResolvedValue({ id: STATION_ID });
      mockPriceHistoryCreate.mockResolvedValue({});
      mockCacheInvalidate.mockRejectedValueOnce(new Error('Redis down'));

      await expect(
        service.overridePrice(STATION_ID, 'ON', 6.2, 'test', ADMIN_ID),
      ).resolves.not.toThrow();
    });
  });

  // ── refreshCache ─────────────────────────────────────────────────────────────

  describe('refreshCache', () => {
    it('throws NotFoundException for unknown station', async () => {
      mockStationFindUnique.mockResolvedValue(null);

      await expect(service.refreshCache('unknown-id', ADMIN_ID)).rejects.toThrow(NotFoundException);
    });

    it('invalidates cache and writes audit log', async () => {
      mockStationFindUnique.mockResolvedValue({ id: STATION_ID });

      await service.refreshCache(STATION_ID, ADMIN_ID);

      expect(mockCacheInvalidate).toHaveBeenCalledWith(STATION_ID);

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: ADMIN_ID,
          action: 'CACHE_REFRESH',
          submission_id: null,
          notes: expect.stringContaining(STATION_ID),
        }),
      });
    });

    it('still writes audit log when cache invalidation fails (fail-open)', async () => {
      mockStationFindUnique.mockResolvedValue({ id: STATION_ID });
      mockCacheInvalidate.mockRejectedValueOnce(new Error('Redis down'));

      await service.refreshCache(STATION_ID, ADMIN_ID);

      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'CACHE_REFRESH' }),
      });
    });
  });

  // ── Story 2.15: Station Hiding ──────────────────────────────────────────────

  describe('hideStation', () => {
    it('sets hidden = true and returns status', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockStationUpdate.mockResolvedValueOnce({});

      const result = await service.hideStation(STATION_ID);

      expect(result).toEqual({ status: 'hidden', stationId: STATION_ID, name: 'Test Station' });
      expect(mockStationUpdate).toHaveBeenCalledWith({
        where: { id: STATION_ID },
        data: { hidden: true },
      });
    });

    it('throws NotFoundException for non-existent station', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);

      await expect(service.hideStation('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('unhideStation', () => {
    it('sets hidden = false and returns status', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockStationUpdate.mockResolvedValueOnce({});

      const result = await service.unhideStation(STATION_ID);

      expect(result).toEqual({ status: 'visible', stationId: STATION_ID, name: 'Test Station' });
      expect(mockStationUpdate).toHaveBeenCalledWith({
        where: { id: STATION_ID },
        data: { hidden: false },
      });
    });

    it('throws NotFoundException for non-existent station', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);

      await expect(service.unhideStation('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findHidden', () => {
    it('returns all hidden stations sorted by updated_at DESC', async () => {
      const hidden = [makeStation({ hidden: true }), makeStation({ id: 'station-2', name: 'Hidden 2', hidden: true })];
      mockStationFindMany.mockResolvedValueOnce(hidden);

      const result = await service.findHidden();

      expect(result).toEqual(hidden);
      expect(mockStationFindMany).toHaveBeenCalledWith({
        where: { hidden: true },
        select: { id: true, name: true, address: true, brand: true, hidden: true },
        orderBy: { updated_at: 'desc' },
      });
    });
  });

  // ── Story 3.19 — renameStation ───────────────────────────────────────────

  describe('renameStation', () => {
    beforeEach(() => {
      // getStationDetail (called at the end of renameStation to return the
      // post-update shape) issues a follow-up findUnique + $queryRaw. Default
      // both so happy-path tests don't have to repeat the setup.
      mockQueryRaw.mockResolvedValue([]);
    });

    it('updates name + sets name_manually_set_at and writes audit log', async () => {
      const NEW_NAME = 'Orlen — Generalska (north)';
      // First findUnique: existing-name lookup. Second findUnique: getStationDetail.
      mockStationFindUnique
        .mockResolvedValueOnce({ id: STATION_ID, name: 'Orlen — Generalska' })
        .mockResolvedValueOnce({
          id: STATION_ID,
          name: NEW_NAME,
          address: 'ul. Generalska 12',
          brand: 'Orlen',
          hidden: false,
          name_manually_set_at: new Date('2026-05-08T10:00:00Z'),
        });
      mockStationUpdate.mockResolvedValue({});

      const result = await service.renameStation(STATION_ID, NEW_NAME, ADMIN_ID);

      expect(result.name).toBe(NEW_NAME);
      expect(result.name_manually_set_at).toBeInstanceOf(Date);
      expect(mockStationUpdate).toHaveBeenCalledWith({
        where: { id: STATION_ID },
        data: expect.objectContaining({
          name: NEW_NAME,
          name_manually_set_at: expect.any(Date),
        }),
      });
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          admin_user_id: ADMIN_ID,
          action: 'STATION_RENAME',
          submission_id: null,
          notes: expect.stringContaining(NEW_NAME),
        }),
      });
    });

    it('trims whitespace from the new name before validating + storing', async () => {
      const NEW_NAME_PADDED = '  Renamed Station  ';
      const NEW_NAME_TRIMMED = 'Renamed Station';
      mockStationFindUnique
        .mockResolvedValueOnce({ id: STATION_ID, name: 'Old Name' })
        .mockResolvedValueOnce({
          id: STATION_ID,
          name: NEW_NAME_TRIMMED,
          address: null,
          brand: null,
          hidden: false,
          name_manually_set_at: new Date(),
        });
      mockStationUpdate.mockResolvedValue({});

      await service.renameStation(STATION_ID, NEW_NAME_PADDED, ADMIN_ID);

      expect(mockStationUpdate).toHaveBeenCalledWith({
        where: { id: STATION_ID },
        data: expect.objectContaining({ name: NEW_NAME_TRIMMED }),
      });
    });

    it('throws BadRequestException for empty/whitespace name (no DB write)', async () => {
      await expect(service.renameStation(STATION_ID, '   ', ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStationFindUnique).not.toHaveBeenCalled();
      expect(mockStationUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for name longer than 200 chars', async () => {
      const tooLong = 'x'.repeat(201);
      await expect(service.renameStation(STATION_ID, tooLong, ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStationFindUnique).not.toHaveBeenCalled();
      expect(mockStationUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when station id does not exist', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);
      await expect(service.renameStation(STATION_ID, 'New', ADMIN_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStationUpdate).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when new name equals current name (after trim)', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ id: STATION_ID, name: 'Same Name' });
      await expect(service.renameStation(STATION_ID, '  Same Name  ', ADMIN_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockStationUpdate).not.toHaveBeenCalled();
    });

    it('refreshes name_manually_set_at on every successful rename', async () => {
      // Repeated rename: existing already has name_manually_set_at set; new
      // rename should still trigger an update with a fresh timestamp.
      mockStationFindUnique
        .mockResolvedValueOnce({ id: STATION_ID, name: 'First Manual Name' })
        .mockResolvedValueOnce({
          id: STATION_ID,
          name: 'Second Manual Name',
          address: null,
          brand: null,
          hidden: false,
          name_manually_set_at: new Date(),
        });
      mockStationUpdate.mockResolvedValue({});

      await service.renameStation(STATION_ID, 'Second Manual Name', ADMIN_ID);

      expect(mockStationUpdate).toHaveBeenCalledWith({
        where: { id: STATION_ID },
        data: expect.objectContaining({
          name: 'Second Manual Name',
          name_manually_set_at: expect.any(Date),
        }),
      });
    });

    // P7 (3.19 review) — audit-log failure must surface as a rejection.
    // Prisma's $transaction([...]) rolls back the batch when any operation
    // throws, so a failing audit write should also roll back the station
    // update. We can't assert the rollback at the unit-test layer (mocks
    // don't simulate Postgres), but we can assert the error propagates so
    // the caller doesn't silently see a "success" with a missing audit row.
    it('propagates audit-log failure (transactional rollback contract)', async () => {
      mockStationFindUnique.mockResolvedValueOnce({ id: STATION_ID, name: 'Old Name' });
      mockTransaction.mockRejectedValueOnce(new Error('audit log down'));

      await expect(
        service.renameStation(STATION_ID, 'New Name', ADMIN_ID),
      ).rejects.toThrow('audit log down');
    });
  });
});
