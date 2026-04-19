# Story 7.6: Chain Registration & Station Grouping

## Metadata
- **Epic:** 7 — Station Partner Portal
- **Story ID:** 7.6
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 2.14 (Station.brand populated by classification), Story 7.1 (apps/partner scaffold), Story 7.2 (ClaimEmailService, ops review pattern)
- **Required by:** Epic 8 (chain-level deal advertising uses Chain model and CHAIN_MANAGER role)

---

## User Story

**As a developer and chain manager,**
I want fuel station chains to be automatically grouped from classification data and chain managers to be able to manage their station list,
So that a chain manager can administer deals and promotions across all their stations without claiming each one individually.

---

## Context & Why

Poland's major chains (ORLEN ~1,800 stations, Circle K, BP, Shell, Moya, Lotos, Amic) account for the majority of fuel stations in the dataset. Making them claim each station individually would kill chain adoption before it starts.

**Important implementation note:** The epics spec references OSM brand tags, but the actual codebase extracts brand from Google Places station names via regex patterns in `StationClassificationService.extractBrand()` (Story 2.14). This story maps `Station.brand` (the output of regex classification) to `Chain` records — not OSM import data. The coverage is equivalent: any station with a recognised brand (non-null, non-'independent') can be auto-assigned.

Auto-assignment at classification time makes the `Chain` grouping explicit in the data model so Epic 8 can run chain-level promotions without scanning brand strings ad hoc.

---

## Acceptance Criteria

**Given** the station classification job runs (initial or incremental)
**When** a station is classified with a non-null, non-'independent' brand (e.g. 'ORLEN')
**Then** a `Chain` record is created for that brand if one does not already exist
**And** the station's `chain_id` is set to that `Chain`'s id

**Given** a station's brand is 'independent' or null
**When** the classification job runs
**Then** `chain_id` remains null — the station is treated as standalone

**Given** a station has been manually assigned to a chain by a chain manager or ops
**When** the classification job re-runs for that station
**Then** its `chain_id` is NOT automatically changed — manual chain assignments take precedence

**Given** a user registers for a partner account and selects "I represent a chain"
**When** they complete registration
**Then** they provide their company NIP (10-digit Polish tax ID) and select or enter their chain name
**And** the account is created and a `ChainClaim` record is created with `status: PENDING`
**And** an ops email notification is sent to `ops@desert.app`

**Given** ops verifies the NIP against the CEIDG/KRS public registry and approves
**When** approval is saved in the admin panel
**Then** the user is granted `CHAIN_MANAGER` role
**And** the `Chain` record's `nip` is set to the verified NIP
**And** the chain manager receives an approval email: "Your chain account is verified. You now have access to [N] stations."

**Given** a chain manager opens their station list in the partner portal
**When** they view it
**Then** they see all stations currently assigned to their `Chain`, paginated, with: name, address, and current verification status (does this station have an approved `StationClaim`?)

**Given** a chain manager wants to remove a station from their chain
**When** they initiate removal
**Then** the station's `chain_id` is set to null
**And** the action is logged in `AdminAuditLog` (action: `CHAIN_STATION_REMOVE`)
**And** if that station has an active deal campaign (Epic 8), the deal is not automatically cancelled

**Given** a chain manager wants to add an unassigned station to their chain
**When** they search for and select a station with `chain_id = null`
**Then** the station's `chain_id` is set to their chain's id
**And** the action is logged (action: `CHAIN_STATION_ADD`)
**And** if the station is already assigned to another chain, the action is blocked with a clear error

**Given** a chain manager adds or removes a station
**When** the action is completed
**Then** it is logged with: chain manager user ID, station ID, action type, timestamp — accessible to ops via the admin audit log

---

## Schema Changes

### Add `CHAIN_MANAGER` to `UserRole` enum

```prisma
enum UserRole {
  DRIVER
  STATION_MANAGER
  CHAIN_MANAGER    // ← new
  FLEET_MANAGER
  ADMIN
  DATA_BUYER
}
```

### New model: `Chain`

```prisma
model Chain {
  id         String   @id @default(uuid())
  name       String   @unique  // e.g. 'ORLEN', 'BP', 'Circle K' — matches Station.brand
  nip        String?  @unique  // Polish NIP set after chain manager verification
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  stations    Station[]
  chainClaims ChainClaim[]
}
```

### New model: `ChainClaim`

```prisma
enum ChainVerificationStatus {
  PENDING
  APPROVED
  REJECTED
}

model ChainClaim {
  id          String                  @id @default(uuid())
  chain_id    String
  user_id     String
  nip         String                  // NIP provided by claimant for ops to verify
  status      ChainVerificationStatus @default(PENDING)
  created_at  DateTime                @default(now())
  reviewed_at DateTime?
  reviewed_by String?                 // admin User.id

  chain Chain @relation(fields: [chain_id], references: [id])
  user  User  @relation(fields: [user_id], references: [id])

  @@unique([chain_id, user_id])
  @@index([status])
}
```

### Additions to `Station` model

```prisma
// Station model — add:
chain_id String?
chain    Chain?  @relation(fields: [chain_id], references: [id])

@@index([chain_id])   // ← new
```

### Additions to `User` model

```prisma
// User model — add:
chainClaims ChainClaim[]
```

**Migration name:** `add_chain_and_chain_claim`

---

## Auto-Assignment: Station Classification Hook

### Where to hook in

`StationClassificationWorker` (in `station-classification.worker.ts`) enqueues a classification job and logs completion. After classification sets `Station.brand`, run chain auto-assignment as an additional step **within the classification worker's `processStation()` method** — no separate queue needed.

### `StationClassificationService` extension

Add `assignChain()` to `StationClassificationService`:

```typescript
/**
 * Called after brand is extracted. Creates Chain if needed and sets chain_id.
 * Idempotency: only sets chain_id if it is currently null (manual assignments preserved).
 */
async assignChain(stationId: string, brand: string | null): Promise<void> {
  // Skip standalone and unclassified stations
  if (!brand || brand === 'independent') return;

  // Only auto-assign if chain_id is currently null (don't overwrite manual assignments)
  const station = await this.prisma.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { chain_id: true },
  });
  if (station.chain_id !== null) return;

  // Upsert Chain record for this brand
  const chain = await this.prisma.chain.upsert({
    where: { name: brand },
    create: { name: brand },
    update: {}, // no-op if already exists
  });

  // Set chain_id on station
  await this.prisma.station.update({
    where: { id: stationId },
    data: { chain_id: chain.id },
  });
}
```

Call from within the per-station classification step, after `brand` is extracted and written:

```typescript
// In StationClassificationService.classifyStation() (or wherever brand is written):
// After: await this.prisma.station.update({ where: { id }, data: { brand, ... } })
await this.assignChain(id, brand);
```

**Note:** `assignChain()` uses `await this.prisma.chain.upsert()` which is idempotent. Concurrent classification jobs for two stations of the same chain (ORLEN) would both try to `upsert` the same Chain — PostgreSQL `@@unique([name])` ensures only one Chain row is created. The second upsert's `create` silently no-ops due to conflict handling.

---

## Chain Manager Registration Flow

### `apps/partner/app/register/page.tsx` — extend with chain option

Add a "I represent a chain" toggle to the registration form. When selected, show:
- **Chain name** — dropdown of known chains (fetched from `GET /v1/partner/chains`) or free text for unlisted
- **Company NIP** — 10-digit number input with basic format validation

### `apps/partner/app/register/actions.ts` — extend `registerAction`

After creating the account (existing flow), if `isChain = true`:

```typescript
// In registerAction, after successful registration:
if (isChain && chainName && nip) {
  await fetch(`${API_URL}/v1/partner/chain-claims`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${body.accessToken}`,
    },
    body: JSON.stringify({ chainName, nip }),
    cache: 'no-store',
  });
  // Non-fatal: user is registered, claim is pending ops review
}
redirect('/register/chain-pending');
```

Create `apps/partner/app/register/chain-pending/page.tsx`:
```typescript
// Static page: "Your chain account is pending verification. We'll email you within 2 business days."
```

### NIP validation (client-side)

```typescript
function isValidNip(nip: string): boolean {
  const digits = nip.replace(/[^0-9]/g, '');
  if (digits.length !== 10) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(digits[i]), 0);
  return sum % 11 === parseInt(digits[9]);
}
```

---

## New API Endpoints

### `GET /v1/partner/chains` — public, list known chains

```typescript
@Public()
@Get('chains')
async listChains() {
  return this.partnerService.listChains();
}

// In PartnerService:
async listChains(): Promise<{ id: string; name: string }[]> {
  return this.db.chain.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
```

### `POST /v1/partner/chain-claims` — authenticated, initiate chain claim

```typescript
@Post('chain-claims')
async initiateChainClaim(@CurrentUser() user: User, @Body() dto: InitiateChainClaimDto) {
  return this.partnerService.initiateChainClaim(user.id, dto.chainName, dto.nip);
}
```

```typescript
// dto/initiate-chain-claim.dto.ts
import { IsString, Length, Matches } from 'class-validator';

export class InitiateChainClaimDto {
  @IsString()
  @Length(1, 100)
  chainName!: string;

  @IsString()
  @Matches(/^[0-9]{10}$/, { message: 'NIP must be 10 digits' })
  nip!: string;
}
```

```typescript
// In PartnerService:
async initiateChainClaim(userId: string, chainName: string, nip: string): Promise<void> {
  // Find or create Chain
  const chain = await this.db.chain.upsert({
    where: { name: chainName },
    create: { name: chainName },
    update: {},
  });

  // Create ChainClaim
  await this.db.chainClaim.upsert({
    where: { chain_id_user_id: { chain_id: chain.id, user_id: userId } },
    create: { chain_id: chain.id, user_id: userId, nip },
    update: { nip, status: 'PENDING' }, // allow re-submission
  });

  // Notify ops
  const user = await this.db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, display_name: true },
  });

  await this.claimEmailService.sendOpsAlert(
    `New chain verification request: ${chainName}`,
    `<p><strong>${user.display_name ?? '—'}</strong> (${user.email ?? '—'}) has requested access to manage chain <strong>${chainName}</strong>.</p>
     <p>NIP provided: <strong>${nip}</strong></p>
     <p>Please verify against CEIDG/KRS and approve or reject in the admin panel.</p>`,
  );
}
```

### Chain manager station management endpoints

```typescript
/** GET /v1/partner/chain/stations?page=1&limit=50 — CHAIN_MANAGER */
@Get('chain/stations')
@Roles(UserRole.CHAIN_MANAGER)
async listChainStations(
  @CurrentUser() user: User,
  @Query('page') page = '1',
  @Query('limit') limit = '50',
) {
  return this.partnerService.listChainStations(
    user.id,
    Math.max(1, parseInt(page)),
    Math.min(100, parseInt(limit)),
  );
}

/** POST /v1/partner/chain/stations — CHAIN_MANAGER, add station */
@Post('chain/stations')
@Roles(UserRole.CHAIN_MANAGER)
async addStationToChain(@CurrentUser() user: User, @Body() dto: ChainStationActionDto) {
  return this.partnerService.addStationToChain(user.id, dto.stationId);
}

/** DELETE /v1/partner/chain/stations/:stationId — CHAIN_MANAGER, remove station */
@Delete('chain/stations/:stationId')
@Roles(UserRole.CHAIN_MANAGER)
async removeStationFromChain(
  @CurrentUser() user: User,
  @Param('stationId') stationId: string,
) {
  return this.partnerService.removeStationFromChain(user.id, stationId);
}
```

```typescript
// dto/chain-station-action.dto.ts
import { IsUUID } from 'class-validator';

export class ChainStationActionDto {
  @IsUUID()
  stationId!: string;
}
```

### `PartnerService` — chain manager methods

```typescript
private async getChainForManager(userId: string): Promise<{ id: string; name: string }> {
  const claim = await this.db.chainClaim.findFirst({
    where: { user_id: userId, status: 'APPROVED' },
    include: { chain: { select: { id: true, name: true } } },
  });
  if (!claim) throw new ForbiddenException('No approved chain claim found');
  return claim.chain;
}

async listChainStations(
  userId: string,
  page: number,
  limit: number,
): Promise<{ data: ChainStationRow[]; total: number }> {
  const chain = await this.getChainForManager(userId);
  const skip = (page - 1) * limit;

  const [stations, total] = await Promise.all([
    this.db.station.findMany({
      where: { chain_id: chain.id },
      select: {
        id: true,
        name: true,
        address: true,
        claims: {
          where: { status: 'APPROVED' },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
      skip,
      take: limit,
    }),
    this.db.station.count({ where: { chain_id: chain.id } }),
  ]);

  return {
    data: stations.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      verificationStatus: s.claims.length > 0 ? 'verified' : 'unclaimed',
    })),
    total,
  };
}

async addStationToChain(userId: string, stationId: string): Promise<void> {
  const chain = await this.getChainForManager(userId);

  const station = await this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { chain_id: true, name: true },
  });

  if (station.chain_id !== null && station.chain_id !== chain.id) {
    throw new ConflictException('Station is already assigned to another chain');
  }

  await this.db.$transaction([
    this.db.station.update({
      where: { id: stationId },
      data: { chain_id: chain.id },
    }),
    this.db.adminAuditLog.create({
      data: {
        admin_user_id: userId, // chain manager ID stored in admin_user_id column
        action: 'CHAIN_STATION_ADD',
        notes: `chain=${chain.id} station=${stationId}`,
      },
    }),
  ]);
}

async removeStationFromChain(userId: string, stationId: string): Promise<void> {
  const chain = await this.getChainForManager(userId);

  const station = await this.db.station.findUniqueOrThrow({
    where: { id: stationId },
    select: { chain_id: true },
  });

  if (station.chain_id !== chain.id) {
    throw new ForbiddenException('Station does not belong to your chain');
  }

  await this.db.$transaction([
    this.db.station.update({
      where: { id: stationId },
      data: { chain_id: null },
    }),
    this.db.adminAuditLog.create({
      data: {
        admin_user_id: userId,
        action: 'CHAIN_STATION_REMOVE',
        notes: `chain=${chain.id} station=${stationId}`,
      },
    }),
  ]);
}
```

---

## Admin Panel: Chain Verification

### New admin pages

```
apps/admin/app/(protected)/chain-claims/
├── page.tsx     # pending chain verification list
└── actions.ts   # approve / reject server actions
```

### Admin API endpoints

Add to `apps/api/src/admin/admin-claims.controller.ts` (or a new `AdminChainController`):

```typescript
/** GET /v1/admin/chain-claims?status=PENDING */
@Get('chain-claims')
@Roles(UserRole.ADMIN)
async listChainClaims(@Query('status') status = 'PENDING') {
  const claims = await this.db.chainClaim.findMany({
    where: { status: status as ChainVerificationStatus },
    include: {
      chain: { select: { name: true } },
      user: { select: { email: true, display_name: true } },
    },
    orderBy: { created_at: 'asc' },
  });
  return claims.map((c) => ({
    id: c.id,
    chain_name: c.chain.name,
    chain_id: c.chain_id,
    claimant_email: c.user.email,
    claimant_name: c.user.display_name,
    nip: c.nip,
    status: c.status,
    created_at: c.created_at.toISOString(),
  }));
}

/** POST /v1/admin/chain-claims/{id}/approve */
@Post('chain-claims/:id/approve')
@Roles(UserRole.ADMIN)
async approveChainClaim(@Param('id') id: string, @CurrentUser() admin: User) {
  const claim = await this.db.chainClaim.findUniqueOrThrow({
    where: { id },
    include: {
      chain: { select: { name: true, id: true } },
      user: { select: { email: true } },
    },
  });

  const stationCount = await this.db.station.count({
    where: { chain_id: claim.chain_id },
  });

  await this.db.$transaction([
    this.db.chainClaim.update({
      where: { id },
      data: { status: 'APPROVED', reviewed_by: admin.id, reviewed_at: new Date() },
    }),
    this.db.user.update({
      where: { id: claim.user_id },
      data: { role: 'CHAIN_MANAGER' },
    }),
    this.db.chain.update({
      where: { id: claim.chain_id },
      data: { nip: claim.nip },
    }),
  ]);

  // Send approval email
  if (claim.user.email) {
    this.claimEmailService
      .sendChainApproval(claim.user.email, claim.chain.name, stationCount)
      .catch(() => undefined);
  }

  return { status: 'approved', stationCount };
}

/** POST /v1/admin/chain-claims/{id}/reject */
@Post('chain-claims/:id/reject')
@Roles(UserRole.ADMIN)
async rejectChainClaim(
  @Param('id') id: string,
  @CurrentUser() admin: User,
  @Body() dto: RejectClaimDto,
) {
  const claim = await this.db.chainClaim.findUniqueOrThrow({
    where: { id },
    include: {
      chain: { select: { name: true } },
      user: { select: { email: true } },
    },
  });

  await this.db.chainClaim.update({
    where: { id },
    data: { status: 'REJECTED', reviewed_by: admin.id, reviewed_at: new Date() },
  });

  if (claim.user.email) {
    this.claimEmailService
      .sendRejection(claim.user.email, claim.chain.name, dto.reason)
      .catch(() => undefined);
  }

  return { status: 'rejected' };
}
```

### Add `sendChainApproval` to `ClaimEmailService`

```typescript
async sendChainApproval(email: string, chainName: string, stationCount: number): Promise<void> {
  const partnerUrl = this.config.get<string>('PARTNER_APP_URL') ?? 'https://partner.desert.app';
  await this.send(
    email,
    `Your chain account is verified — desert partner`,
    `<p>Your account for <strong>${chainName}</strong> has been approved.</p>
     <p>You now have access to <strong>${stationCount} stations</strong>.</p>
     <p><a href="${partnerUrl}/login?redirect=/chain">Log in to manage your stations →</a></p>`,
  );
}
```

### Admin sidebar — add "Chain Claims" nav item

In `apps/admin/app/(protected)/layout.tsx`:
```typescript
{ href: '/chain-claims', label: t.nav.chainClaims },
```

---

## Partner App: Chain Manager UI

### `app/page.tsx` — update root redirect logic

```typescript
// Add to getPartnerMe response:
interface MeResponse {
  role: string;
  managedStationId?: string;   // STATION_MANAGER
  managedChainId?: string;     // CHAIN_MANAGER  ← new
}

// In PartnerService.getPartnerMe():
if (user.role === 'CHAIN_MANAGER') {
  const claim = await this.db.chainClaim.findFirst({
    where: { user_id: userId, status: 'APPROVED' },
    select: { chain_id: true },
  });
  return { role: user.role, managedChainId: claim?.chain_id ?? undefined };
}

// In app/page.tsx:
if (me.role === 'CHAIN_MANAGER' && me.managedChainId) {
  redirect('/chain');
}
if (me.role === 'CHAIN_MANAGER') {
  redirect('/register/chain-pending'); // still awaiting approval
}
```

### New partner app pages

```
apps/partner/app/(partner)/chain/
├── page.tsx           # station list with pagination
└── stations/
    └── add/
        └── page.tsx   # search for unassigned stations to add
```

### `app/(partner)/chain/page.tsx` (Server Component)

```typescript
import { partnerFetch } from '../../../../lib/partner-api';
import ChainStationList from '../../../../components/ChainStationList';

export default async function ChainPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page = '1' } = await searchParams;
  const data = await partnerFetch<ChainStationsResult>(
    `/v1/partner/chain/stations?page=${page}&limit=50`,
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your stations</h1>
        <a
          href="/chain/stations/add"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add station
        </a>
      </div>
      <ChainStationList data={data} currentPage={parseInt(page)} />
    </main>
  );
}
```

### `components/ChainStationList.tsx` (Client Component)

Renders paginated table:
- Columns: Station name | Address | Status (verified / unclaimed badge) | Remove button
- Remove calls `removeStationAction(stationId)` Server Action → `DELETE /v1/partner/chain/stations/{id}`
- Pagination: previous/next links

### `app/(partner)/chain/stations/add/page.tsx` (Server Component + Client search)

Reuses the station search pattern from Story 7.1's `ClaimOptionsPanel`, but filters to show only stations with `chain_id = null` (unassigned). The search endpoint can accept an `?unassigned=true` query param:

```typescript
// In PartnerService.searchStations(), add optional filter:
async searchStations(query: string, unassignedOnly = false): Promise<StationSearchResult[]> {
  return this.db.$queryRaw<StationSearchResult[]>`
    SELECT s.id, s.name, s.address, s.brand, s.voivodeship,
      CASE
        WHEN EXISTS (SELECT 1 FROM "StationClaim" c WHERE c.station_id = s.id AND c.status = 'APPROVED') THEN 'verified'
        WHEN EXISTS (SELECT 1 FROM "StationClaim" c WHERE c.station_id = s.id AND c.status = 'PENDING') THEN 'pending'
        ELSE 'unclaimed'
      END AS claim_status
    FROM "Station" s
    WHERE (s.name ILIKE ${'%' + query + '%'} OR s.address ILIKE ${'%' + query + '%'})
    ${unassignedOnly ? Prisma.sql`AND s.chain_id IS NULL` : Prisma.empty}
    ORDER BY s.name
    LIMIT 20
  `;
}
```

Add "Add to chain" button per result row that calls `POST /v1/partner/chain/stations`.

---

## `apps/partner/middleware.ts` update

The existing middleware allows any authenticated user. No change needed — `CHAIN_MANAGER` role passes the token validity check. Route-level enforcement is done at the API (`@Roles(UserRole.CHAIN_MANAGER)`).

---

## `PartnerModule` updates

No new imports needed for `PrismaModule`, `RedisModule` (already in PartnerModule). Add new DTOs:

```typescript
// In PartnerModule providers array — no changes needed (all new logic is in PartnerService and PartnerController)
```

Export `ChainStationRow` type from `apps/partner/lib/types.ts`:

```typescript
export interface ChainStationRow {
  id: string;
  name: string;
  address: string | null;
  verificationStatus: 'verified' | 'unclaimed';
}

export interface ChainStationsResult {
  data: ChainStationRow[];
  total: number;
}

export interface ChainClaimRow {
  id: string;
  chain_name: string;
  chain_id: string;
  claimant_email: string | null;
  claimant_name: string | null;
  nip: string;
  status: string;
  created_at: string;
}
```

---

## Dev Notes

### Chain name collision: free-text entry vs existing chains
If the chain manager enters a chain name in free text (e.g. "orlen" instead of "ORLEN"), the `upsert` will create a separate `Chain` record because `@@unique([name])` is case-sensitive. Add normalisation:

```typescript
const normalisedName = chainName.trim();
// Consider: normalisedName.toUpperCase() — but this would break 'Circle K' → 'CIRCLE K'
// Better: match against known chain list first, fall through to raw name
const KNOWN_CHAINS = ['ORLEN', 'BP', 'Circle K', 'Shell', 'Lotos', 'Moya', 'Amic'];
const matched = KNOWN_CHAINS.find(
  (c) => c.toLowerCase() === normalisedName.toLowerCase(),
);
const finalName = matched ?? normalisedName;
```

Apply this normalisation in `initiateChainClaim()` before the upsert.

### `AdminAuditLog` for chain manager actions
`AdminAuditLog.admin_user_id` stores the actor's user ID. For chain manager actions (add/remove station), the chain manager's `user_id` is stored there — the column name is misleading but the data type (String) accommodates any user ID. This avoids creating a separate audit table. Ops can filter by `action IN ('CHAIN_STATION_ADD', 'CHAIN_STATION_REMOVE')` to see chain manager history.

### Auto-assignment idempotency on re-classification
`assignChain()` checks `station.chain_id !== null` before setting — this preserves manual assignments. However, if a chain manager removes a station from their chain (sets `chain_id = null`) and the classification job re-runs, `assignChain()` would re-assign it based on `Station.brand`. This is a known limitation for MVP: manually removed stations will be re-assigned on next classification run.

Mitigation: add a `chain_id_locked Boolean @default(false)` field to `Station` (set to true on manual add/remove), and skip auto-assignment when locked. **Deferred to post-MVP** — document in `project_deferred.md`.

### OSM brand tag coverage note from epics
The epics spec mentions "OSM brand tag coverage for Polish stations is ~73%." In our system, this refers to the coverage of the regex brand extractor: stations whose Google Places name matches a known brand pattern. The classification service falls back to 'independent' for the remainder. These 'independent' stations keep `chain_id = null` — consistent with the 73% figure.

### NIP verification is manual for MVP
CEIDG/KRS has a public API (`https://api.ceidg.gov.pl/`) and KRS has `https://api-krs.ms.gov.pl/`. For MVP, ops verifies the NIP manually by looking up the company on the public registry website. The NIP is stored in `ChainClaim.nip` for ops to cross-reference. Automated NIP verification via API can be added post-MVP — document in `project_deferred.md`.

### `CHAIN_MANAGER` role and partner portal middleware
The partner app middleware accepts any authenticated user (no role restriction). API-level `@Roles(UserRole.CHAIN_MANAGER)` enforces that only chain managers can access chain endpoints. A `CHAIN_MANAGER` trying to access `/station/{id}` endpoints (which require `STATION_MANAGER`) will get 403 from the API. The partner app server-side redirect logic in `app/page.tsx` routes by role to avoid this.

### Epic 8 dependency
`Chain.id` is the FK that Epic 8's deal campaigns will reference for chain-level promotions. This story establishes the `Chain` model and all chain-to-station assignments. Epic 8 should build on this without schema changes to `Chain` itself.

### Data migration: existing stations with brand set
The `Station.brand` field is already populated by Story 2.14 for all classified stations. After this migration runs, a one-off script should back-fill `chain_id` for all existing stations:

```sql
-- Back-fill chain_id for all existing classified stations
-- Run once after migration, not part of the Prisma migration file itself
INSERT INTO "Chain" (id, name, created_at, updated_at)
  SELECT gen_random_uuid(), brand, NOW(), NOW()
  FROM "Station"
  WHERE brand IS NOT NULL AND brand != 'independent'
  GROUP BY brand
ON CONFLICT (name) DO NOTHING;

UPDATE "Station" s
SET chain_id = c.id
FROM "Chain" c
WHERE s.brand = c.name
  AND s.brand IS NOT NULL
  AND s.brand != 'independent'
  AND s.chain_id IS NULL;
```

Document this as a post-migration ops step. **Do not include it in the Prisma migration file** — it should be run separately to allow rollback if needed.

---

## Tasks

- [ ] **Schema:** Add `CHAIN_MANAGER` to `UserRole` enum; add `Chain` model; add `ChainVerificationStatus` enum and `ChainClaim` model; add `chain_id String?`, `chain Chain? @relation(...)`, `@@index([chain_id])` to `Station`; add `chainClaims ChainClaim[]` to `User`; run `prisma migrate dev --name add_chain_and_chain_claim`
- [ ] **API:** Add `assignChain(stationId, brand)` to `StationClassificationService`; call it after brand is written in the classification step
- [ ] **API:** Add `listChains()`, `initiateChainClaim()`, `getPartnerMe()` update (CHAIN_MANAGER branch), `listChainStations()`, `addStationToChain()`, `removeStationFromChain()` to `PartnerService`
- [ ] **API:** Add `GET /v1/partner/chains`, `POST /v1/partner/chain-claims`, `GET /v1/partner/chain/stations`, `POST /v1/partner/chain/stations`, `DELETE /v1/partner/chain/stations/:stationId` to `PartnerController`
- [ ] **API:** Create `InitiateChainClaimDto`, `ChainStationActionDto` DTOs
- [ ] **API:** Extend `searchStations()` with optional `unassignedOnly` filter
- [ ] **API:** Add chain claim admin endpoints (`GET /v1/admin/chain-claims`, approve, reject) — add to `AdminClaimsController` or new `AdminChainController`
- [ ] **API:** Add `sendChainApproval()` to `ClaimEmailService` (in `apps/api/src/partner/claim-email.service.ts`)
- [ ] **API:** Add chain claim type annotations to `AdminModule`
- [ ] **Admin:** Add `ChainClaimRow` type to `apps/admin/lib/types.ts`
- [ ] **Admin:** Create `apps/admin/app/(protected)/chain-claims/page.tsx` and `actions.ts`
- [ ] **Admin:** Add "Chain Claims" to admin sidebar nav and i18n strings
- [ ] **Partner app:** Extend `app/register/` form with chain option (toggle, chain name field, NIP input with validation)
- [ ] **Partner app:** Create `app/register/chain-pending/page.tsx` — pending verification confirmation screen
- [ ] **Partner app:** Create `app/(partner)/chain/page.tsx` and `components/ChainStationList.tsx`
- [ ] **Partner app:** Create `app/(partner)/chain/stations/add/page.tsx` with unassigned station search
- [ ] **Partner app:** Update `app/page.tsx` root redirect logic for `CHAIN_MANAGER` role
- [ ] **Partner app:** Add `ChainStationRow`, `ChainStationsResult`, `ChainClaimRow` types to `apps/partner/lib/types.ts`
- [ ] **Partner app:** Add chain management i18n strings to `lib/i18n.ts` (pl/en/uk)
- [ ] **Ops:** Run back-fill SQL for existing stations after migration (documented above — run separately, not in migration file)
- [ ] **Sprint status:** Mark 7.6 ready-for-dev in sprint-status.yaml
