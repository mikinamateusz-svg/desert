import { Test, TestingModule } from '@nestjs/testing';
import { Logger, NotFoundException } from '@nestjs/common';
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
});
