import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PriceController } from './price.controller.js';
import { PriceService } from './price.service.js';
import { GetNearbyPricesDto } from './dto/get-nearby-prices.dto.js';

const now = new Date('2026-01-15T12:00:00.000Z');

const fakePriceRows = [
  { stationId: 'station-1', prices: { PB_95: 6.42, ON: 6.89 }, sources: { PB_95: 'community', ON: 'community' }, updatedAt: now },
  { stationId: 'station-2', prices: { PB_95: 6.55, LPG: 2.89 }, sources: { PB_95: 'community', LPG: 'community' }, updatedAt: now },
];

const mockPriceService = {
  findPricesInArea: jest.fn(),
};

describe('PriceController', () => {
  let controller: PriceController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PriceController],
      providers: [
        { provide: PriceService, useValue: mockPriceService },
      ],
    }).compile();

    controller = module.get<PriceController>(PriceController);
  });

  describe('auth guard', () => {
    it('declares @Public() — unauthenticated access for SSR public map', () => {
      const reflector = new Reflector();
      const isPublic = reflector.get<boolean>('isPublic', controller.getNearby);
      expect(isPublic).toBe(true);
    });
  });

  describe('getNearby', () => {
    it('returns StationPriceDto[] on valid lat/lng', async () => {
      mockPriceService.findPricesInArea.mockResolvedValueOnce(fakePriceRows);

      const dto: GetNearbyPricesDto = { lat: 52.23, lng: 21.01 };
      const result = await controller.getNearby(dto);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        stationId: 'station-1',
        prices: { PB_95: 6.42, ON: 6.89 },
        sources: { PB_95: 'community', ON: 'community' },
      });
    });

    it('serialises updatedAt as ISO string', async () => {
      mockPriceService.findPricesInArea.mockResolvedValueOnce(fakePriceRows);

      const result = await controller.getNearby({ lat: 52.23, lng: 21.01 });

      expect(typeof result[0]?.updatedAt).toBe('string');
      expect(result[0]?.updatedAt).toBe(now.toISOString());
    });

    it('calls findPricesInArea with default radius 25000 when not provided', async () => {
      mockPriceService.findPricesInArea.mockResolvedValueOnce([]);

      await controller.getNearby({ lat: 52.23, lng: 21.01 });

      expect(mockPriceService.findPricesInArea).toHaveBeenCalledWith(52.23, 21.01, 25000);
    });

    it('calls findPricesInArea with explicit radius when provided', async () => {
      mockPriceService.findPricesInArea.mockResolvedValueOnce([]);

      await controller.getNearby({ lat: 52.23, lng: 21.01, radius: 10000 });

      expect(mockPriceService.findPricesInArea).toHaveBeenCalledWith(52.23, 21.01, 10000);
    });

    it('returns empty array when service returns no rows', async () => {
      mockPriceService.findPricesInArea.mockResolvedValueOnce([]);

      const result = await controller.getNearby({ lat: 52.23, lng: 21.01 });

      expect(result).toEqual([]);
    });

    it('propagates errors thrown by service', async () => {
      mockPriceService.findPricesInArea.mockRejectedValueOnce(new Error('DB error'));

      await expect(controller.getNearby({ lat: 52.23, lng: 21.01 })).rejects.toThrow('DB error');
    });
  });

  describe('ValidationPipe integration', () => {
    let pipe: ValidationPipe;

    beforeEach(() => {
      pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    });

    it('accepts valid lat/lng query params', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01' },
        { type: 'query', metatype: GetNearbyPricesDto },
      );
      expect(result.lat).toBe(52.23);
      expect(result.lng).toBe(21.01);
    });

    it('transforms string lat/lng to numbers', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01' },
        { type: 'query', metatype: GetNearbyPricesDto },
      );
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lng).toBe('number');
    });

    it('rejects lat above 90', async () => {
      await expect(
        pipe.transform({ lat: '91', lng: '21.01' }, { type: 'query', metatype: GetNearbyPricesDto }),
      ).rejects.toThrow();
    });

    it('rejects lat below -90', async () => {
      await expect(
        pipe.transform({ lat: '-91', lng: '21.01' }, { type: 'query', metatype: GetNearbyPricesDto }),
      ).rejects.toThrow();
    });

    it('rejects lng above 180', async () => {
      await expect(
        pipe.transform({ lat: '52.23', lng: '181' }, { type: 'query', metatype: GetNearbyPricesDto }),
      ).rejects.toThrow();
    });

    it('rejects lng below -180', async () => {
      await expect(
        pipe.transform({ lat: '52.23', lng: '-181' }, { type: 'query', metatype: GetNearbyPricesDto }),
      ).rejects.toThrow();
    });

    it('rejects radius above 50000', async () => {
      await expect(
        pipe.transform(
          { lat: '52.23', lng: '21.01', radius: '60000' },
          { type: 'query', metatype: GetNearbyPricesDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects radius below 100', async () => {
      await expect(
        pipe.transform(
          { lat: '52.23', lng: '21.01', radius: '50' },
          { type: 'query', metatype: GetNearbyPricesDto },
        ),
      ).rejects.toThrow();
    });

    it('accepts radius at boundary 50000', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01', radius: '50000' },
        { type: 'query', metatype: GetNearbyPricesDto },
      );
      expect(result.radius).toBe(50000);
    });

    it('accepts optional radius omitted', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01' },
        { type: 'query', metatype: GetNearbyPricesDto },
      );
      expect(result.radius).toBeUndefined();
    });
  });
});
