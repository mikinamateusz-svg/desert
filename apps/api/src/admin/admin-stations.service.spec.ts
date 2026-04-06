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

const mockPrisma = {
  station: {
    findMany: mockStationFindMany,
    count: mockStationCount,
    findUnique: mockStationFindUnique,
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
});
