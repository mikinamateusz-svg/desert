import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { StationController } from './station.controller.js';
import { StationService } from './station.service.js';
import { GetNearbyStationsDto } from './dto/get-nearby-stations.dto.js';

const fakeStations = [
  { id: 'abc', name: 'Orlen', address: 'ul. Test 1', google_places_id: 'gp_1', lat: 52.23, lng: 21.01 },
  { id: 'def', name: 'BP', address: 'ul. Test 2', google_places_id: 'gp_2', lat: 52.24, lng: 21.02 },
];

const mockStationService = {
  findStationsInArea: jest.fn(),
};

describe('StationController', () => {
  let controller: StationController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StationController],
      providers: [
        { provide: StationService, useValue: mockStationService },
      ],
    }).compile();

    controller = module.get<StationController>(StationController);
  });

  describe('getNearby', () => {
    it('returns station array on valid lat/lng', async () => {
      mockStationService.findStationsInArea.mockResolvedValueOnce(fakeStations);

      const dto: GetNearbyStationsDto = { lat: 52.23, lng: 21.01 };
      const result = await controller.getNearby(dto);

      expect(result).toEqual(fakeStations);
    });

    it('calls findStationsInArea with default radius 25000 when not provided', async () => {
      mockStationService.findStationsInArea.mockResolvedValueOnce([]);

      await controller.getNearby({ lat: 52.23, lng: 21.01 });

      expect(mockStationService.findStationsInArea).toHaveBeenCalledWith(52.23, 21.01, 25000);
    });

    it('calls findStationsInArea with explicit radius when provided', async () => {
      mockStationService.findStationsInArea.mockResolvedValueOnce([]);

      await controller.getNearby({ lat: 52.23, lng: 21.01, radius: 10000 });

      expect(mockStationService.findStationsInArea).toHaveBeenCalledWith(52.23, 21.01, 10000);
    });

    it('returns empty array when service returns no stations', async () => {
      mockStationService.findStationsInArea.mockResolvedValueOnce([]);

      const result = await controller.getNearby({ lat: 52.23, lng: 21.01 });

      expect(result).toEqual([]);
    });

    it('propagates errors thrown by service', async () => {
      mockStationService.findStationsInArea.mockRejectedValueOnce(new Error('DB error'));

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
        { type: 'query', metatype: GetNearbyStationsDto },
      );
      expect(result.lat).toBe(52.23);
      expect(result.lng).toBe(21.01);
    });

    it('transforms string lat/lng to numbers', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01' },
        { type: 'query', metatype: GetNearbyStationsDto },
      );
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lng).toBe('number');
    });

    it('rejects when lat is missing', async () => {
      await expect(
        pipe.transform({ lng: '21.01' }, { type: 'query', metatype: GetNearbyStationsDto }),
      ).rejects.toThrow();
    });

    it('rejects when lng is missing', async () => {
      await expect(
        pipe.transform({ lat: '52.23' }, { type: 'query', metatype: GetNearbyStationsDto }),
      ).rejects.toThrow();
    });

    it('rejects radius above 50000', async () => {
      await expect(
        pipe.transform(
          { lat: '52.23', lng: '21.01', radius: '60000' },
          { type: 'query', metatype: GetNearbyStationsDto },
        ),
      ).rejects.toThrow();
    });

    it('rejects radius below 100', async () => {
      await expect(
        pipe.transform(
          { lat: '52.23', lng: '21.01', radius: '50' },
          { type: 'query', metatype: GetNearbyStationsDto },
        ),
      ).rejects.toThrow();
    });

    it('accepts radius at boundary 50000', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01', radius: '50000' },
        { type: 'query', metatype: GetNearbyStationsDto },
      );
      expect(result.radius).toBe(50000);
    });

    it('accepts optional radius omitted', async () => {
      const result = await pipe.transform(
        { lat: '52.23', lng: '21.01' },
        { type: 'query', metatype: GetNearbyStationsDto },
      );
      expect(result.radius).toBeUndefined();
    });
  });
});
