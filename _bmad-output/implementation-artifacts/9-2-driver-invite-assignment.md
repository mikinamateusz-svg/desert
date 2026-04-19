# Story 9.2: Driver Invite & Assignment

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.2
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (`Fleet`, `Vehicle` models, `FleetModule`, `apps/fleet` scaffold, `fleetFetch`)
- **Required by:** Story 9.3 (fill-up records attributed to vehicle via assignment), Story 9.4 (reports filter by driver)

---

## User Story

**As a fleet manager,**
I want to invite drivers and assign them to vehicles,
So that fill-up activity is automatically attributed to the right vehicle and driver.

---

## Context & Why

Driver attribution is what makes fleet reporting (Story 9.3) meaningful — without knowing which driver was using which vehicle, per-vehicle costs become unattributable. The invite flow must work for both existing desert app users (drivers who already have an account) and brand-new users who haven't signed up yet.

### Data model decisions

- **`FleetInvite`**: token-based invite with 7-day expiry. One invite per email per fleet. Re-invite cancels any prior PENDING invite and creates a fresh one.
- **`VehicleAssignment`**: tracks driver–vehicle assignments over time with `unassigned_at` for history. A vehicle can have one active assignment at a time (`unassigned_at IS NULL`). A driver can be assigned to multiple vehicles simultaneously (common in small fleets where drivers share vehicles by day).
- **Driver role stays `DRIVER`**: fleet membership is expressed via `User.fleet_id`, not a role change. Fleet-scoped data access is enforced at the service layer (`driver.fleet_id = manager.fleet_id`).

---

## Acceptance Criteria

**Given** a fleet manager opens the Drivers section
**When** they view it
**Then** they see a list of drivers currently in their fleet (name, email, assigned vehicle if any) and an "Invite Driver" button

**Given** a fleet manager invites a driver by email
**When** they submit the invite form
**Then** a `FleetInvite` record is created with a unique token and 7-day expiry
**And** an invite email is sent: "You've been invited to join [Fleet Name] on desert. [Accept Invite]"
**And** the driver appears in the Drivers list with status "Invited"
**And** if a PENDING invite for the same email already exists in this fleet, it is cancelled and a fresh one is created

**Given** the invited driver clicks the invite link
**When** they have an existing desert account (any role)
**Then** they are redirected to `apps/fleet` login; after logging in, their `fleet_id` is set and the invite is marked ACCEPTED

**Given** the invited driver clicks the invite link
**When** they do not have a desert account
**Then** they are shown a registration form pre-filled with their email
**And** after completing registration, their account is created with `role: DRIVER`, `fleet_id` set, and the invite is marked ACCEPTED

**Given** an invite link is opened more than 7 days after creation
**When** the token is validated
**Then** the invite is marked EXPIRED and the driver sees: "This invite has expired. Ask your fleet manager to send a new one."

**Given** a fleet manager wants to assign a driver to a vehicle
**When** they select a driver and a vehicle
**Then** a `VehicleAssignment` record is created
**And** if the driver already has an active assignment to a different vehicle, that assignment's `unassigned_at` is set (one active vehicle per driver at a time)
**And** if the vehicle already has an active assignment to a different driver, that assignment is similarly closed

**Given** a fleet manager removes a driver from the fleet
**When** they confirm removal
**Then** the driver's `fleet_id` is set to null
**And** any active `VehicleAssignment` for that driver is closed (`unassigned_at = now()`)
**And** historical assignment and fill-up data is preserved

---

## Schema Changes

### New Models

```prisma
enum InviteStatus {
  PENDING
  ACCEPTED
  EXPIRED
}

model FleetInvite {
  id          String       @id @default(cuid())
  fleet_id    String
  fleet       Fleet        @relation(fields: [fleet_id], references: [id])
  email       String
  token       String       @unique @default(uuid())
  status      InviteStatus @default(PENDING)
  invited_by  String       // User.id of fleet manager
  expires_at  DateTime     // created_at + 7 days
  accepted_at DateTime?
  accepted_by String?      // User.id of driver who accepted
  created_at  DateTime     @default(now())

  @@unique([fleet_id, email, status])  // prevent duplicate PENDING invites (partial — enforced in service)
  @@index([fleet_id, status])
  @@index([token])
}

model VehicleAssignment {
  id            String    @id @default(cuid())
  vehicle_id    String
  vehicle       Vehicle   @relation(fields: [vehicle_id], references: [id])
  driver_id     String
  driver        User      @relation("DriverAssignments", fields: [driver_id], references: [id])
  assigned_at   DateTime  @default(now())
  unassigned_at DateTime?

  @@index([vehicle_id, unassigned_at])
  @@index([driver_id, unassigned_at])
}
```

### Fleet Model Addition

```prisma
// Add to Fleet model:
model Fleet {
  // ... existing fields ...
  invites  FleetInvite[]
}
```

### Vehicle Model Addition

```prisma
// Add to Vehicle model:
model Vehicle {
  // ... existing fields ...
  assignments VehicleAssignment[]
}
```

### User Model Addition

```prisma
// Add to User model:
model User {
  // ... existing fields ...
  vehicle_assignments VehicleAssignment[] @relation("DriverAssignments")
}
```

### Migration Name

`add_fleet_invite_and_vehicle_assignment`

---

## API Changes

### FleetController Additions

```typescript
// All endpoints @Roles(FLEET_MANAGER) unless noted

// GET /v1/fleet/drivers
// Returns: FleetDriverDto[] — users with fleet_id = manager's fleet, ordered by display_name
// Each item: { id, email, displayName, assignedVehicle: { id, name, registration } | null, inviteStatus: null }

// GET /v1/fleet/invites
// Returns: FleetInviteDto[] — PENDING invites for the fleet

// POST /v1/fleet/invites
// Body: { email: string }
// Cancels any existing PENDING invite for this email in this fleet, creates new one, sends email
// Returns: FleetInviteDto

// DELETE /v1/fleet/invites/:id
// Cancels (expires) a PENDING invite
// Returns: 204

// POST /v1/fleet/invites/accept  @Public()
// Body: { token: string, password?: string, displayName?: string }
// Validates token, sets fleet_id, marks invite ACCEPTED
// If no existing user: creates User first
// Returns: { token: string } → sets fleet_token cookie (driver can now log in to fleet app)
// Note: driver receives DRIVER role, not FLEET_MANAGER

// POST /v1/fleet/drivers/:driverId/assign-vehicle
// Body: { vehicleId: string }
// Creates VehicleAssignment; closes prior assignment for driver + vehicle
// Returns: VehicleAssignmentDto

// DELETE /v1/fleet/drivers/:driverId/assign-vehicle
// Closes active VehicleAssignment for driver (unassigned_at = now())
// Returns: 204

// DELETE /v1/fleet/drivers/:driverId
// Removes driver from fleet: fleet_id = null, close active assignment
// Returns: 204
```

### New DTOs

```typescript
export class InviteDriverDto {
  @IsEmail()
  email: string;
}

export class AcceptInviteDto {
  @IsString() @IsUUID()
  token: string;

  // Required only for new users (no existing account):
  @IsOptional() @IsString() @MinLength(8)
  password?: string;

  @IsOptional() @IsString() @MaxLength(100)
  displayName?: string;
}

export class AssignVehicleDto {
  @IsString()
  vehicleId: string;
}
```

### FleetService — Key Methods

```typescript
// inviteDriver(fleetManagerId: string, email: string): Promise<FleetInviteDto>
//   1. Load manager's fleet (fleetId from JWT)
//   2. Check driver not already in fleet: User WHERE email=X AND fleet_id=fleetId → throw 409
//   3. Cancel any existing PENDING invite: update FleetInvite status=EXPIRED WHERE fleet_id AND email AND status=PENDING
//   4. Create FleetInvite { fleet_id, email, expires_at: now()+7d }
//   5. Send invite email via FleetEmailService (fire-and-forget)
//   6. Return invite DTO

// acceptInvite(dto: AcceptInviteDto, req): Promise<void>
//   1. Load FleetInvite by token
//   2. If not found: throw 404
//   3. If status !== PENDING: throw 410 ('INVITE_EXPIRED' or 'INVITE_ALREADY_USED')
//   4. If expires_at < now(): set status=EXPIRED, throw 410 ('INVITE_EXPIRED')
//   5. Find existing User by invite.email:
//      - If found: set user.fleet_id = invite.fleet_id
//      - If not found AND dto.password provided: create User { email, password(hashed), displayName, role: DRIVER, fleet_id }
//      - If not found AND no password: throw 400 ('ACCOUNT_REQUIRED') — frontend shows registration form
//   6. Set invite.status = ACCEPTED, invite.accepted_at = now(), invite.accepted_by = user.id
//   7. Issue DRIVER JWT with { sub: userId, role: 'DRIVER', fleetId: invite.fleet_id }
//      → set fleet_token cookie (allows driver to log in to fleet app for their own data)

// assignVehicle(fleetManagerId: string, driverId: string, vehicleId: string): Promise<void>
//   1. Verify driver.fleet_id === manager.fleet_id (scoping check)
//   2. Verify vehicle.fleet_id === manager.fleet_id
//   3. Close existing active assignment for driver (if any):
//      UPDATE VehicleAssignment SET unassigned_at=now() WHERE driver_id=X AND unassigned_at IS NULL
//   4. Close existing active assignment for vehicle (if any):
//      UPDATE VehicleAssignment SET unassigned_at=now() WHERE vehicle_id=X AND unassigned_at IS NULL
//   5. Create VehicleAssignment { vehicle_id, driver_id }

// removeDriver(fleetManagerId: string, driverId: string): Promise<void>
//   1. Scoping check
//   2. Close active assignment
//   3. Set user.fleet_id = null
```

### FleetEmailService

```typescript
// apps/api/src/fleet/fleet-email.service.ts
// Uses Resend (same pattern as ClaimEmailService, DealEmailService)

// sendInvite(email: string, fleetName: string, token: string): Promise<void>
//   Subject: "Zaproszenie do floty [fleetName] w desert"
//   Body:
//     "Zostałeś zaproszony do dołączenia do floty [fleetName] w aplikacji desert.
//      Kliknij link poniżej, aby zaakceptować zaproszenie (ważne 7 dni):
//      [FLEET_APP_URL]/invite/accept?token=[token]"
```

Add `FLEET_APP_URL` to `apps/api/.env.example`.

---

## Invite Accept Flow — apps/fleet

### New Page: /invite/accept

```
apps/fleet/app/invite/
└── accept/
    └── page.tsx       # Server Component — reads ?token= from URL
```

```tsx
// app/invite/accept/page.tsx — Server Component
// 1. Read token from searchParams
// 2. Call GET /v1/fleet/invites/validate?token=X (new lightweight endpoint — just validates token, returns { fleetName, email, valid, reason? })
// 3. If invalid/expired: show error message with reason
// 4. If valid + user exists (determined after login attempt): show "Log in to accept" form
// 5. If valid + new user: show registration form (email pre-filled, locked)
```

Two client component forms:

**ExistingUserAcceptForm** — for drivers who already have an account:
```
"Log in to accept the invite from [Fleet Name]"
Email (pre-filled, read-only)  Password
[Accept & Join Fleet] button
→ calls acceptInviteAction({ token, password: undefined }) after login
```

**NewUserAcceptForm** — for new users:
```
"Create your account to join [Fleet Name]"
Display name  Email (pre-filled, read-only)  Password
[Create Account & Join] button
→ calls acceptInviteAction({ token, password, displayName })
```

The page first tries `AcceptInviteDto` with no password to check if the email has an existing account. The API returns `400 ACCOUNT_REQUIRED` if not, at which point the frontend switches to the new-user form.

Simpler alternative: just always show both fields (display name + password). If email exists, password is used to authenticate; display name is ignored. This avoids the extra round-trip check.

**Chosen: single form** with display name + password. API handles both paths internally.

```typescript
// app/invite/accept/actions.ts
'use server';
export async function acceptInviteAction(token: string, formData: FormData) {
  const result = await fetch(`${process.env.API_URL}/v1/fleet/invites/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      password: formData.get('password'),
      displayName: formData.get('displayName') ?? undefined,
    }),
  });
  // On success: set fleet_token cookie from response, redirect to /dashboard
  // On error: return { error: message }
}
```

Note: this server action calls the API without the `fleet_token` cookie (user is not yet logged in). Uses raw `fetch` not `fleetFetch`.

### GET /v1/fleet/invites/validate?token=

```typescript
// @Public() lightweight endpoint — just checks token validity, does NOT accept the invite
// Returns: { valid: boolean; fleetName?: string; email?: string; reason?: 'expired' | 'already_used' | 'not_found' }
```

---

## apps/fleet — Drivers Page

### /(fleet)/drivers/page.tsx — Server Component

```tsx
// Fetches in parallel:
//   GET /v1/fleet/drivers   → active fleet members
//   GET /v1/fleet/invites   → pending invites
//
// Renders two sections:
// ── Active drivers ──────────────────────────────
// [Name]  [Email]  [Vehicle]      [Unassign] [Remove]
// Company Driver  wa12345 (Van1)  [×]        [Remove]
// ────────────────────────────────────────────────
// ── Pending invites ─────────────────────────────
// [Email]         [Sent]          [Cancel]
// driver@corp.pl  7 Apr 2026      [×]
// ────────────────────────────────────────────────
// [+ Invite Driver] button (opens InviteForm inline)
```

### InviteForm — Client Component

Inline form below the list (same pattern as AddVehicleForm in 9.1):

```tsx
// Single email input + [Send Invite] button
// On submit: calls inviteDriverAction(formData) → revalidatePath('/drivers')
// Shows success: "Invite sent to [email]"
// Shows error: "This driver is already in your fleet" or "Invite already sent"
```

### AssignVehicleSelect — Client Component

Dropdown in the Active drivers row:

```tsx
// When driver has no vehicle assigned: shows "Assign vehicle" dropdown
// When driver has vehicle: shows vehicle name + [×] unassign button
// On selection change: calls assignVehicleAction(driverId, vehicleId) → revalidatePath('/drivers')
// Vehicle options: fetched once via GET /v1/fleet/vehicles (passed as prop from Server Component)
```

---

## Environment Variables

Add to `apps/api/.env.example`:

```bash
FLEET_APP_URL=http://localhost:3005
```

---

## Tasks / Subtasks

- [ ] Prisma schema: `FleetInvite`, `VehicleAssignment`, `InviteStatus` enum, relations on Fleet/Vehicle/User (AC: all)
  - [ ] Migration `add_fleet_invite_and_vehicle_assignment`
  - [ ] `prisma generate`

- [ ] FleetEmailService (AC: 2)
  - [ ] `sendInvite()` — Resend, Polish subject/body
  - [ ] Register in FleetModule

- [ ] FleetService — invite flow (AC: 2, 3, 4, 5)
  - [ ] `inviteDriver()` — cancel prior PENDING, create new, send email
  - [ ] `acceptInvite()` — validate token, existing vs new user paths, set fleet_id, issue JWT, set cookie
  - [ ] `GET /v1/fleet/invites/validate` (@Public, token check only)
  - [ ] `cancelInvite()` — fleet manager cancels PENDING

- [ ] FleetService — driver management (AC: 1, 7)
  - [ ] `listDrivers()` — users with fleet_id, include active assignment
  - [ ] `removeDriver()` — clear fleet_id, close assignment

- [ ] FleetService — assignment (AC: 6)
  - [ ] `assignVehicle()` — close prior driver + vehicle assignments, create new
  - [ ] `unassignVehicle()` — close active assignment for driver

- [ ] FleetController — new endpoints (AC: all)
  - [ ] `GET /v1/fleet/drivers`
  - [ ] `GET /v1/fleet/invites`
  - [ ] `POST /v1/fleet/invites`
  - [ ] `DELETE /v1/fleet/invites/:id`
  - [ ] `POST /v1/fleet/invites/accept` (@Public)
  - [ ] `GET /v1/fleet/invites/validate` (@Public)
  - [ ] `POST /v1/fleet/drivers/:id/assign-vehicle`
  - [ ] `DELETE /v1/fleet/drivers/:id/assign-vehicle`
  - [ ] `DELETE /v1/fleet/drivers/:id`

- [ ] apps/fleet: /invite/accept page (AC: 3, 4, 5)
  - [ ] Server Component reads token from searchParams, calls validate
  - [ ] Single unified form (display name + password)
  - [ ] `acceptInviteAction` server action (raw fetch, no fleet_token)
  - [ ] Error states: expired, already used, not found

- [ ] apps/fleet: /drivers page (AC: 1, 2, 6, 7)
  - [ ] Server Component fetches drivers + invites in parallel
  - [ ] Active drivers table with vehicle column
  - [ ] Pending invites section
  - [ ] `InviteForm` Client Component
  - [ ] `AssignVehicleSelect` Client Component

- [ ] apps/fleet: sidebar nav — add "Drivers" link (/(fleet)/layout.tsx)
- [ ] Add `FLEET_APP_URL` to `apps/api/.env.example`

---

## Dev Notes

### @@unique([fleet_id, email, status]) — Partial Unique

Prisma doesn't support partial unique indexes (WHERE status = 'PENDING'). The `@@unique([fleet_id, email, status])` constraint means two rows can exist with the same fleet_id + email if they have different statuses (e.g. one ACCEPTED, one PENDING — possible after a driver leaves and is re-invited). This is correct behaviour. The "cancel prior PENDING" logic in `inviteDriver()` handles the race condition at the service layer.

### JWT for Drivers in Fleet App

When a driver accepts an invite, they receive a `fleet_token` JWT with `role: DRIVER`. The `apps/fleet` middleware currently only allows `FLEET_MANAGER`. Two options:

**Option A:** Allow `DRIVER` role through middleware for the fleet app — drivers can view their own fill-up history in a separate `/my-activity` section.

**Option B:** The invite accept endpoint sets the `fleet_token` cookie only for the `FLEET_MANAGER` redirect case. Drivers don't get a fleet app session — they use the mobile app.

**Chosen: Option B for MVP.** Drivers use the mobile app for fill-up submission. The fleet app is exclusively for managers. The `fleet_token` is issued only for `FLEET_MANAGER` role. After accepting an invite, the driver is simply redirected to a success page: "You've joined [Fleet Name]. Open the desert app to start logging fill-ups."

This avoids complicating the middleware and the fleet app scope. If driver self-service in the fleet web app is needed post-MVP, add it then.

### acceptInvite — Existing User with Wrong Role

If the existing User has `role: ADMIN` or `role: STATION_MANAGER` — reject the invite accept with `400 ROLE_CONFLICT`. Fleet membership is only for `DRIVER` role users. Display: "This email is registered as a different account type. Contact support."

### One Active Assignment Per Driver

```typescript
// Close driver's active assignment before creating new:
await this.prisma.vehicleAssignment.updateMany({
  where: { driver_id: driverId, unassigned_at: null },
  data: { unassigned_at: new Date() },
});
```

This uses `updateMany` (not `update`) since there should only ever be one, but `updateMany` is safer. The `@@index([driver_id, unassigned_at])` ensures this is fast.

### Invite Token — UUID Security

`FleetInvite.token` defaults to `@default(uuid())` via Prisma. UUIDs are not cryptographically secure tokens — they are UUID v4 (random), which provides 122 bits of entropy. This is sufficient for an invite link valid for 7 days. No additional token generation needed.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
