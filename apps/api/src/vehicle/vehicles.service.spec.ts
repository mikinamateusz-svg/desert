import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockFindUniqueOrThrow = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockDelete = jest.fn();
const mockDeleteMany = jest.fn();

const mockPrisma = {
  vehicle: {
    findMany: mockFindMany,
    findFirst: mockFindFirst,
    findUnique: mockFindUnique,
    findUniqueOrThrow: mockFindUniqueOrThrow,
    create: mockCreate,
    update: mockUpdate,
    updateMany: mockUpdateMany,
    delete: mockDelete,
    deleteMany: mockDeleteMany,
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
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce({ ...existing, nickname: 'Renamed' });

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'Renamed' });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, user_id: USER_ID, is_locked: false },
        data: { nickname: 'Renamed' },
      });
    });

    it('updates make/model/year on an unlocked vehicle', async () => {
      const existing = makeVehicle({ is_locked: false });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
      });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, user_id: USER_ID, is_locked: false },
        data: { make: 'Skoda', model: 'Octavia', year: 2021 },
      });
    });

    it('only updates the fields explicitly present in the DTO', async () => {
      const existing = makeVehicle({ is_locked: false });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'X' });

      const callArgs = mockUpdateMany.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(callArgs.data).toEqual({ nickname: 'X' });
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
      expect(mockUpdateMany).not.toHaveBeenCalled();
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

    it('rejects with 409 when caller tries to change fuel_type on a locked vehicle (history-corrupting)', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, fuel_type: 'ON' }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { fuel_type: 'PB_95' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects with 409 when caller tries to change displacement_cc on a locked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, displacement_cc: 1598 }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { displacement_cc: 1968 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects with 409 when caller tries to change power_kw on a locked vehicle', async () => {
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: true, power_kw: 85 }));

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { power_kw: 110 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('allows nickname change on a locked vehicle (history-safe)', async () => {
      const existing = makeVehicle({ is_locked: true });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce({ ...existing, nickname: 'Dad-mobile' });

      await service.updateVehicle(USER_ID, VEHICLE_ID, { nickname: 'Dad-mobile' });

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, user_id: USER_ID, is_locked: true },
        data: { nickname: 'Dad-mobile' },
      });
    });

    it('allows engine_variant change on a locked vehicle (e.g. correcting a typo)', async () => {
      const existing = makeVehicle({ is_locked: true });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        engine_variant: '2.0 TDI 150 KM',
      });

      expect(mockUpdateMany).toHaveBeenCalled();
    });

    it('does NOT trigger 409 when DTO repeats the existing make/model/year (no actual change)', async () => {
      const existing = makeVehicle({ is_locked: true, make: 'Volkswagen', model: 'Golf', year: 2020 });
      mockFindUnique.mockResolvedValueOnce(existing);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindUniqueOrThrow.mockResolvedValueOnce(existing);

      await service.updateVehicle(USER_ID, VEHICLE_ID, {
        make: 'Volkswagen',
        model: 'Golf',
        year: 2020,
        nickname: 'X',
      });

      expect(mockUpdateMany).toHaveBeenCalled();
    });

    it('throws 409 when concurrent FillUp locks the vehicle between read and write (TOCTOU close)', async () => {
      // Vehicle observed unlocked; a concurrent FillUp flips is_locked to true
      // before our updateMany fires. updateMany returns count: 0 because the
      // is_locked: false predicate no longer matches.
      mockFindUnique.mockResolvedValueOnce(makeVehicle({ is_locked: false }));
      mockUpdateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.updateVehicle(USER_ID, VEHICLE_ID, { make: 'Skoda' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(mockFindUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('deleteVehicle', () => {
    it('deletes an unlocked vehicle via atomic deleteMany', async () => {
      mockDeleteMany.mockResolvedValueOnce({ count: 1 });

      await service.deleteVehicle(USER_ID, VEHICLE_ID);

      expect(mockDeleteMany).toHaveBeenCalledWith({
        where: { id: VEHICLE_ID, user_id: USER_ID, is_locked: false },
      });
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('rejects with 409 when the vehicle is locked (has fill-up history)', async () => {
      mockDeleteMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValueOnce(makeVehicle({ is_locked: true }));

      await expect(service.deleteVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws NotFound (not Forbidden) when trying to delete another user\'s vehicle', async () => {
      // Cross-user delete: deleteMany is scoped to user_id so count is 0;
      // findFirst (also user-scoped) returns null because the vehicle belongs
      // to a different user.
      mockDeleteMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(service.deleteVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound when the vehicle id does not exist at all', async () => {
      mockDeleteMany.mockResolvedValueOnce({ count: 0 });
      mockFindFirst.mockResolvedValueOnce(null);

      await expect(service.deleteVehicle(USER_ID, VEHICLE_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
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
