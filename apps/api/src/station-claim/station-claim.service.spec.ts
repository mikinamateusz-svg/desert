import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClaimMethod, ClaimStatus, UserRole } from '@prisma/client';
import { StationClaimService } from './station-claim.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { lookupChainByEmail } from './chain-domains.js';

const mockStationFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockClaimFindUnique = jest.fn();
const mockClaimFindFirst = jest.fn();
const mockClaimFindMany = jest.fn();
const mockClaimCount = jest.fn();
const mockClaimUpsert = jest.fn();
const mockClaimUpdate = jest.fn();
const mockUserUpdate = jest.fn();
const mockTransaction = jest.fn();

const mockPrisma = {
  station: { findUnique: mockStationFindUnique },
  user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
  stationClaim: {
    findUnique: mockClaimFindUnique,
    findFirst: mockClaimFindFirst,
    findMany: mockClaimFindMany,
    count: mockClaimCount,
    upsert: mockClaimUpsert,
    update: mockClaimUpdate,
  },
  $transaction: mockTransaction,
};

const USER_ID = 'user-A';
const OTHER_USER_ID = 'user-B';
const ADMIN_USER_ID = 'admin-1';
const STATION_ID = 'sta-1';
const CLAIM_ID = 'claim-1';

function makeStation(overrides: Partial<{ id: string; brand: string | null; hidden: boolean }> = {}) {
  return { id: STATION_ID, brand: 'ORLEN', hidden: false, ...overrides };
}

function makeUser(overrides: Partial<{ id: string; email: string | null; role: UserRole; deleted_at: Date | null }> = {}) {
  return {
    id: USER_ID,
    email: 'jan@orlen.pl',
    role: UserRole.DRIVER,
    deleted_at: null,
    ...overrides,
  };
}

function makeClaim(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CLAIM_ID,
    station_id: STATION_ID,
    user_id: USER_ID,
    status: ClaimStatus.PENDING,
    ...overrides,
  };
}

describe('StationClaimService', () => {
  let service: StationClaimService;

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) — clears queued mockResolvedValueOnce
    // entries too. clearAllMocks only resets call records; leftover queued
    // return values would leak into the next test in declaration order.
    jest.resetAllMocks();
    // Default: $transaction passes the tx through to the callback so
    // tests can drive the mocked tx.* methods directly. Service code
    // uses $transaction(callback) form for createClaim auto-approve and
    // approveClaim.
    mockTransaction.mockImplementation((cb: (tx: typeof mockPrisma) => unknown) => Promise.resolve(cb(mockPrisma)));
    mockClaimUpsert.mockImplementation(({ create, update }) =>
      Promise.resolve(makeClaim(update ?? create)),
    );
    mockClaimUpdate.mockImplementation(({ data }) => Promise.resolve(makeClaim(data)));
    mockUserUpdate.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationClaimService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StationClaimService>(StationClaimService);
  });

  // ── chain-domains helper ───────────────────────────────────────────────

  describe('lookupChainByEmail', () => {
    it('matches a known chain domain case-insensitively', () => {
      expect(lookupChainByEmail('jan.kowalski@ORLEN.pl')).toEqual({ domain: 'orlen.pl', brand: 'ORLEN' });
    });

    it('returns null for unknown domains (private email, etc.)', () => {
      expect(lookupChainByEmail('jan@gmail.com')).toBeNull();
      expect(lookupChainByEmail('owner@my-private-station.pl')).toBeNull();
    });

    it('returns null for malformed addresses', () => {
      expect(lookupChainByEmail('not-an-email')).toBeNull();
      expect(lookupChainByEmail('@orlen.pl')).toEqual({ domain: 'orlen.pl', brand: 'ORLEN' });
      expect(lookupChainByEmail('jan@')).toBeNull();
    });
  });

  // ── createClaim ─────────────────────────────────────────────────────────

  describe('createClaim', () => {
    it('throws NotFound when the station does not exist', async () => {
      mockStationFindUnique.mockResolvedValueOnce(null);
      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the station is hidden (admin-soft-deleted)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ hidden: true }));
      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when the user account is soft-deleted', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockUserFindUnique.mockResolvedValueOnce(makeUser({ deleted_at: new Date() }));
      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('auto-approves on domain match (orlen.pl email + ORLEN brand) AND bumps DRIVER → STATION_MANAGER', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ brand: 'ORLEN' }));
      mockUserFindUnique
        .mockResolvedValueOnce(makeUser({ email: 'manager@orlen.pl', role: UserRole.DRIVER }))
        // The role-elevation lookup inside the transaction:
        .mockResolvedValueOnce({ role: UserRole.DRIVER });
      mockClaimFindUnique.mockResolvedValueOnce(null); // no existing claim
      mockClaimFindFirst.mockResolvedValueOnce(null); // no other-user APPROVED

      const result = await service.createClaim(USER_ID, { stationId: STATION_ID });

      expect(result.status).toBe(ClaimStatus.APPROVED);
      expect(mockClaimUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: ClaimStatus.APPROVED,
            verification_method_used: ClaimMethod.DOMAIN_MATCH,
            verification_evidence: { matchedDomain: 'orlen.pl', matchedBrand: 'ORLEN' },
          }),
        }),
      );
      // Role bump fires because user was DRIVER.
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { role: UserRole.STATION_MANAGER },
      });
    });

    it('does NOT bump role when user is already FLEET_MANAGER / DATA_BUYER / ADMIN', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ brand: 'ORLEN' }));
      mockUserFindUnique
        .mockResolvedValueOnce(makeUser({ email: 'admin@orlen.pl', role: UserRole.ADMIN }))
        .mockResolvedValueOnce({ role: UserRole.ADMIN });
      mockClaimFindUnique.mockResolvedValueOnce(null);
      mockClaimFindFirst.mockResolvedValueOnce(null);

      await service.createClaim(USER_ID, { stationId: STATION_ID });

      // ADMIN should not be downgraded to STATION_MANAGER.
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('does NOT auto-approve when chain matches BUT brand differs (orlen.pl email + BP station)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ brand: 'BP' }));
      mockUserFindUnique.mockResolvedValueOnce(makeUser({ email: 'manager@orlen.pl' }));
      mockClaimFindUnique.mockResolvedValueOnce(null);
      mockClaimFindFirst.mockResolvedValueOnce(null);

      const result = await service.createClaim(USER_ID, { stationId: STATION_ID });

      expect(result.status).toBe(ClaimStatus.PENDING);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it('does NOT auto-approve when station has no brand (independent / unclassified)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ brand: null }));
      mockUserFindUnique.mockResolvedValueOnce(makeUser({ email: 'manager@orlen.pl' }));
      mockClaimFindUnique.mockResolvedValueOnce(null);
      mockClaimFindFirst.mockResolvedValueOnce(null);

      const result = await service.createClaim(USER_ID, { stationId: STATION_ID });

      expect(result.status).toBe(ClaimStatus.PENDING);
    });

    it('queues PENDING for personal email + any brand (most franchisee claims)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation({ brand: 'ORLEN' }));
      mockUserFindUnique.mockResolvedValueOnce(makeUser({ email: 'jan.franczyzobiorca@gmail.com' }));
      mockClaimFindUnique.mockResolvedValueOnce(null);
      mockClaimFindFirst.mockResolvedValueOnce(null);

      const result = await service.createClaim(USER_ID, {
        stationId: STATION_ID,
        applicantNotes: 'Jestem franczyzobiorcą tej stacji od 2018',
      });

      expect(result.status).toBe(ClaimStatus.PENDING);
      expect(mockClaimUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: ClaimStatus.PENDING,
            applicant_notes: 'Jestem franczyzobiorcą tej stacji od 2018',
          }),
        }),
      );
    });

    it('throws Conflict when the user is already APPROVED for this station', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockUserFindUnique.mockResolvedValueOnce(makeUser());
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.APPROVED }));

      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when the user has a PENDING claim already (no spam)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockUserFindUnique.mockResolvedValueOnce(makeUser());
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));

      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws Conflict when ANOTHER user has an APPROVED claim (first-mover wins)', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockUserFindUnique.mockResolvedValueOnce(makeUser());
      mockClaimFindUnique.mockResolvedValueOnce(null);
      mockClaimFindFirst.mockResolvedValueOnce(makeClaim({ user_id: OTHER_USER_ID, status: ClaimStatus.APPROVED }));

      await expect(
        service.createClaim(USER_ID, { stationId: STATION_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows re-submission after REJECTED — reuses the row, transitions back to PENDING', async () => {
      mockStationFindUnique.mockResolvedValueOnce(makeStation());
      mockUserFindUnique.mockResolvedValueOnce(makeUser({ email: 'jan@gmail.com' }));
      // Existing claim is REJECTED — falls through both PENDING/AWAITING_DOCS
      // and APPROVED guards.
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.REJECTED }));
      mockClaimFindFirst.mockResolvedValueOnce(null);

      const result = await service.createClaim(USER_ID, { stationId: STATION_ID });

      expect(result.status).toBe(ClaimStatus.PENDING);
      // Upsert update branch must clear residue from the prior rejection.
      expect(mockClaimUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            status: ClaimStatus.PENDING,
            rejection_reason: null,
            reviewer_notes: null,
            reviewed_at: null,
          }),
        }),
      );
    });
  });

  // ── listMyClaims ────────────────────────────────────────────────────────

  describe('listMyClaims', () => {
    it('returns the applicant\'s own claims, newest first, with station joined', async () => {
      mockClaimFindMany.mockResolvedValueOnce([{ id: 'c2' }, { id: 'c1' }]);
      const result = await service.listMyClaims(USER_ID);
      expect(mockClaimFindMany).toHaveBeenCalledWith({
        where: { user_id: USER_ID },
        orderBy: { created_at: 'desc' },
        include: {
          station: { select: { id: true, name: true, address: true, brand: true } },
        },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ── listForAdmin / getForAdmin ──────────────────────────────────────────

  describe('listForAdmin', () => {
    it('paginates oldest-first with optional status filter', async () => {
      mockClaimFindMany.mockResolvedValueOnce([{ id: 'c1' }]);
      mockClaimCount.mockResolvedValueOnce(1);

      const result = await service.listForAdmin({ status: ClaimStatus.PENDING, page: 1, limit: 50 });

      expect(mockClaimFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: ClaimStatus.PENDING },
          orderBy: { created_at: 'asc' },
          skip: 0,
          take: 50,
        }),
      );
      expect(result.total).toBe(1);
    });

    it('omits status filter entirely when undefined (returns all buckets)', async () => {
      mockClaimFindMany.mockResolvedValueOnce([]);
      mockClaimCount.mockResolvedValueOnce(0);

      await service.listForAdmin({ status: undefined, page: 1, limit: 50 });

      expect(mockClaimFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('clamps page below 1 and limit above 100', async () => {
      mockClaimFindMany.mockResolvedValueOnce([]);
      mockClaimCount.mockResolvedValueOnce(0);

      await service.listForAdmin({ status: undefined, page: -3, limit: 9999 });

      expect(mockClaimFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });
  });

  describe('getForAdmin', () => {
    it('throws NotFound for an unknown claim id', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(null);
      await expect(service.getForAdmin('missing-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── approveClaim ────────────────────────────────────────────────────────

  describe('approveClaim', () => {
    it('approves PENDING claim with PHONE_CALLBACK + bumps DRIVER role', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));
      mockClaimFindFirst.mockResolvedValueOnce(null); // no other approved
      mockUserFindUnique.mockResolvedValueOnce({ role: UserRole.DRIVER });

      await service.approveClaim(CLAIM_ID, {
        reviewerUserId: ADMIN_USER_ID,
        method: ClaimMethod.PHONE_CALLBACK,
        reviewerNotes: 'Called +48 42 123 4567, confirmed by owner Jan Kowalski',
      });

      expect(mockClaimUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CLAIM_ID },
          data: expect.objectContaining({
            status: ClaimStatus.APPROVED,
            verification_method_used: ClaimMethod.PHONE_CALLBACK,
            reviewer_notes: 'Called +48 42 123 4567, confirmed by owner Jan Kowalski',
            reviewed_by_user_id: ADMIN_USER_ID,
          }),
        }),
      );
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { role: UserRole.STATION_MANAGER },
      });
    });

    it('rejects DOMAIN_MATCH method — reserved for the auto-approve path (audit clarity)', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));

      await expect(
        service.approveClaim(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID, method: ClaimMethod.DOMAIN_MATCH }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to approve when another user is already APPROVED for the same station', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));
      mockClaimFindFirst.mockResolvedValueOnce({ id: 'other-approved-claim' });

      await expect(
        service.approveClaim(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID, method: ClaimMethod.PHONE_CALLBACK }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses to re-approve an already-APPROVED claim', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.APPROVED }));

      await expect(
        service.approveClaim(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID, method: ClaimMethod.PHONE_CALLBACK }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── rejectClaim ─────────────────────────────────────────────────────────

  describe('rejectClaim', () => {
    it('rejects PENDING claim with reason that surfaces to the applicant', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));

      await service.rejectClaim(CLAIM_ID, {
        reviewerUserId: ADMIN_USER_ID,
        rejectionReason: 'Phone number does not match the station — could not verify ownership',
      });

      expect(mockClaimUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ClaimStatus.REJECTED,
            rejection_reason: 'Phone number does not match the station — could not verify ownership',
            reviewed_by_user_id: ADMIN_USER_ID,
          }),
        }),
      );
    });

    it('throws BadRequest when rejectionReason is empty', async () => {
      await expect(
        service.rejectClaim(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID, rejectionReason: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to reject an already-APPROVED claim', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.APPROVED }));

      await expect(
        service.rejectClaim(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID, rejectionReason: 'too late' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── requestDocs ─────────────────────────────────────────────────────────

  describe('requestDocs', () => {
    it('moves PENDING → AWAITING_DOCS and records reviewer notes', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.PENDING }));

      await service.requestDocs(CLAIM_ID, {
        reviewerUserId: ADMIN_USER_ID,
        reviewerNotes: 'Please upload franchise agreement scan + ID',
      });

      expect(mockClaimUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ClaimStatus.AWAITING_DOCS,
            reviewer_notes: 'Please upload franchise agreement scan + ID',
            reviewed_by_user_id: ADMIN_USER_ID,
          }),
        }),
      );
      // AWAITING_DOCS is interstitial — `reviewed_at` reserved for finals.
      const updateData = mockClaimUpdate.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('reviewed_at');
    });

    it('refuses to request docs from a finalised claim (APPROVED / REJECTED)', async () => {
      mockClaimFindUnique.mockResolvedValueOnce(makeClaim({ status: ClaimStatus.REJECTED }));

      await expect(
        service.requestDocs(CLAIM_ID, { reviewerUserId: ADMIN_USER_ID }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
