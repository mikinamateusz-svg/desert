import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDelete = jest.fn();

const mockPrisma = {
  vehicle: {
    findMany: mockFindMany,
    findUnique: mockFindUnique,
    create: mockCreate,
    update: mockUpdate,
    updateMany: mockUpdateMany,
    delete: mockDelete,
  },
};

const USER_ID = 'user-A';
const OTHER_USER_ID = 'user-B';
const VEHICLE_ID = 'veh-123';

function makeVehicle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VEHICLE_ID,
    user_id: USER_ID,
    make: 'Volkswagen',
    model: 'Golf',
    year: 2020,
    engine_variant: '1.6 TDI 115 KM',
    displacement_cc: 1598,
    power_kw: 85,
    fuel_type: 'ON',
    nickname: 'My Golf',
    is_locked: false,
    user_entered: false,
    created_at: new Date('2026-04-26'),
    updated_at: new Date('2026-04-26'),
    ...overrides,
  };
}

describe('VehiclesService', () => {
  let service: VehiclesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [VehiclesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<VehiclesService>(VehiclesService);
  });

  describe('listVehicles', () => {
    it('returns user vehicles ordered by created_at asc', async () => {
      const vehicles = [makeVehicle()];
      mockFindMany.mockResolvedValueOnce(vehicles);

      const result = await service.listVehicles(USER_ID);

      expect(result).toBe(vehicles);
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        orderBy: { created_at: 'asc' },
      });
    });

    it('returns empty array for a user with no vehicles', async () => {
      mockFindMany.mockResolvedValueOnce([]);
      await expect(service.listVehicles(USER_ID)).resolves.toEqual([]);
    });
  });

  describe('getVehicle', () => {
    it('returns the vehicle when it belongs to the requesting user', async () => {
      const vehicle = makeVehicle();
      mockFindUnique.mockResolvedValueOnce(vehicle);

      const result = await service.getVehicle(USER_ID, VEHICLE_ID);

      expect(result).toBe(vehicle);
    });

    it('throws NotFound when the vehicle does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null);
      await expect(service.getVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound (not Forbidden) when the vehicle belongs to another user — does not leak existence', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ user_id: OTHER_USER_ID }));
      await expect(service.getVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createVehicle', () => {
    it('creates a vehicle scoped to the authenticated user (ignores any caller-supplied user_id)', async () => {
      mockCreate.mockResolvedValueOnce(makeVehicle());

      await service.createVehicle(USER_ID, {
        make: 'Volkswagen',
        model: 'Golf',
        year: 2020,
        fuel_type: 'ON',
        engine_variant: '1.6 TDI 115 KM',
        displacement_cc: 1598,
        power_kw: 85,
        nickname: 'My Golf',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: USER_ID,
          make: 'Volkswagen',
          model: 'Golf',
          year: 2020,
          fuel_type: 'ON',
          engine_variant: '1.6 TDI 115 KM',
          displacement_cc: 1598,
          power_kw: 85,
          nickname: 'My Golf',
          user_entered: false,
        }),
      });
    });

    it('persists user_entered=true when caller flagged the record as free-text', async () => {
      mockCreate.mockResolvedValueOnce(makeVehicle({ user_entered: true }));

      await service.createVehicle(USER_ID, {
        make: 'NicheBrand',
        model: 'CustomModel',
        year: 2018,
        fuel_type: 'PB_95',
        user_entered: true,
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_entered: true }),
      });
    });

    it('defaults user_entered=false when not provided', async () => {
      mockCreate.mockResolvedValueOnce(makeVehicle());

      await service.createVehicle(USER_ID, {
        make: 'Volkswagen',
        model: 'Golf',
        year: 2020,
        fuel_type: 'ON',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ user_entered: false }),
      });
    });

    it('coerces optional undefined fields to null in the persisted record', async () => {
      mockCreate.mockResolvedValueOnce(makeVehicle());

      await service.createVehicle(USER_ID, {
        make: 'Tesla',
        model: 'Model 3',
        year: 2023,
        fuel_type: 'EV',
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          engine_variant: null,
          displacement_cc: null,
          power_kw: null,
          nickname: null,
        }),
      });
    });
  });

  describe('updateVehicle — unlocked', () => {
    it('updates nickname on an unlocked vehicle', async () => {
      const existing = makeVehicle({ is_locked: false });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce({ ...existing, nickname: 'Renamed' });

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'Renamed' });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID },
        data: { nickname: 'Renamed' },
      });
    });

    it('updates make/model/year on an unlocked vehicle', async () => {
      const existing = makeVehicle({ is_locked: false });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID },
        data: { make: 'Skoda', model: 'Octavia', year: 2021 },
      });
    });

    it('only updates the fields explicitly present in the DTO', async () => {
      const existing = makeVehicle({ is_locked: false });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'X' });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID },
        data: { nickname: 'X' },
      });
      const callArgs = mockUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(callArgs.data).not.toHaveProperty('make');
      expect(callArgs.data).not.toHaveProperty('model');
      expect(callArgs.data).not.toHaveProperty('year');
    });
  });

  describe('updateVehicle — locked', () => {
    it('rejects with 409 when caller tries to change make on a locked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, make: 'VW' }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { make: 'Skoda' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects with 409 when caller tries to change model on a locked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, model: 'Golf' }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { model: 'Polo' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects with 409 when caller tries to change year on a locked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, year: 2020 }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { year: 2021 }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows nickname change on a locked vehicle (history-safe)', async () => {
      const existing = makeVehicle({ is_locked: true });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce({ ...existing, nickname: 'Dad-mobile' });

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'Dad-mobile' });

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID },
        data: { nickname: 'Dad-mobile' },
      });
    });

    it('allows engine_variant change on a locked vehicle (e.g. correcting a typo)', async () => {
      const existing = makeVehicle({ is_locked: true });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        engine_variant: '2.0 TDI 150 KM',
      });

      expect(mockUpdate).toHaveBeenCalled();
    });

    it('does NOT trigger 409 when DTO repeats the existing make/model/year (no actual change)', async () => {
      const existing = makeVehicle({ is_locked: true, make: 'Volkswagen', model: 'Golf', year: 2020 });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdate.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        make: 'Volkswagen',
        model: 'Golf',
        year: 2020,
        nickname: 'X',
      });

      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe('deleteVehicle', () => {
    it('deletes an unlocked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: false }));
      mockDelete.mockResolvedValueOnce({});

      await service.deleteVehicle(USER_ID, VEHICLE_ID);

      expect(mockDelete).toHaveBeenCalledWith({ where: { id: VEHICLE_ID } });
    });

    it('rejects with 409 when the vehicle is locked (has fill-up history)', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true }));

      await expect(service.deleteVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('throws NotFound (not Forbidden) when trying to delete another user\'s vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ user_id: OTHER_USER_ID }));

      await expect(service.deleteVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });
  });

  describe('lockVehicle', () => {
    it('sets is_locked=true via updateMany (idempotent on already-locked records)', async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });

      await service.lockVehicle(VEHICLE_ID);

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, is_locked: false },
        data: { is_locked: true },
      });
    });

    it('does not throw when the vehicle is already locked (count: 0 case)', async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.lockVehicle(VEHICLE_ID)).resolves.toBeUndefined();
    });
  });
});
