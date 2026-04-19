# Story 9.1: Fleet Account Setup & Vehicle Management

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.1
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 1.x (SuperTokens auth, User model, JWT cookie pattern), Story 8.8 would be Fleet Subscription Billing (9.8) — but fleet account creation is gated only by email verification for now; subscription payment added in 9.8
- **Required by:** Story 9.2 (driver invite), 9.3 (dashboard), 9.4 (reports), 9.5 (alerts), 9.6 (route suggestions), 9.7 (API keys), 9.8 (billing)

---

## User Story

**As a fleet manager,**
I want to create a fleet account and manage my vehicle list,
So that I can track fuel costs and usage across my entire fleet.

---

## Context & Why

The fleet tier is a B2B product — fleet managers are typically logistics coordinators, transport managers, or small business owners tracking company vehicle costs. The `apps/fleet` web app is designed **mobile-first** (fleet managers often work on tablets or phones on-site) but fully functional on desktop.

The `Fleet` and `Vehicle` models are the foundational data layer for all of Epic 9. Getting them right here avoids retrofitting in later stories.

### apps/fleet Scaffold

New Next.js 16 app at `apps/fleet/`, following `apps/admin` exactly:
- Cookie: `fleet_token` (httpOnly JWT)
- Role guard: `FLEET_MANAGER` (middleware rejects any other role)
- Helper: `fleetFetch` (same pattern as `adminFetch`)
- Port: 3005
- Package name: `@desert/fleet`

The `apps/partner` app (Epic 7) follows the same pattern — when it is built, dev can reference either.

---

## Acceptance Criteria

**Given** a new user wants to create a fleet account
**When** they sign up at `apps/fleet` registration page
**Then** they provide: company name (fleet name), their name, email, and password
**And** a `Fleet` record is created with `subscription_status: FREE_TRIAL`
**And** their `User` record has `role: FLEET_MANAGER` and `fleet_id` set to the new fleet's id
**And** they are redirected to the fleet dashboard

**Given** an existing driver account wants to upgrade to fleet manager
**When** they log in at `apps/fleet` and initiate fleet creation
**Then** the same flow runs: fleet created, role upgraded to `FLEET_MANAGER`, `fleet_id` set
**And** their mobile driver access is not affected (role change is fleet-app-scoped; mobile JWT is re-issued on next login)

**Given** a fleet manager opens the Vehicles section
**When** they view it
**Then** they see a list of their fleet's vehicles (name, registration plate, fuel type preference), and a button to add a vehicle

**Given** a fleet manager adds a vehicle
**When** they fill in: vehicle name (required), registration plate (required), fuel type preference (optional)
**Then** the vehicle is added to the fleet
**And** registration plate is stored in uppercase, stripped of spaces (e.g. "WA 12345" → "WA12345")
**And** duplicate registration plate within the same fleet is rejected with a clear error

**Given** a fleet manager edits a vehicle
**When** they update the name, registration, or fuel type
**Then** changes are saved and the vehicle list refreshes

**Given** a fleet manager deletes a vehicle
**When** they confirm deletion
**Then** the vehicle is soft-deleted (`deleted_at` set) — historical fill-up data (Story 9.3) is preserved
**And** the vehicle no longer appears in the active vehicle list

---

## Schema Changes

### Fleet Model (from architecture spec — implement now)

```prisma
enum FleetSubscriptionStatus {
  FREE_TRIAL
  ACTIVE
  PAST_DUE
  CANCELLED
}

model Fleet {
  id                  String                  @id @default(cuid())
  name                String
  owner_id            String                  @unique
  owner               User                    @relation("FleetOwner", fields: [owner_id], references: [id])
  subscription_status FleetSubscriptionStatus @default(FREE_TRIAL)
  trial_ends_at       DateTime?               // set at creation: now() + 30 days
  stripe_customer_id  String?
  stripe_subscription_id String?
  created_at          DateTime                @default(now())
  updated_at          DateTime                @updatedAt

  members             User[]                  @relation("FleetMembers")
  vehicles            Vehicle[]
}
```

### Vehicle Model

```prisma
model Vehicle {
  id           String    @id @default(cuid())
  fleet_id     String
  fleet        Fleet     @relation(fields: [fleet_id], references: [id])
  name         String
  registration String    // normalised: uppercase, no spaces
  fuel_type    String?   // 'PB_95' | 'ON' | 'PB_98' | 'LPG' | null
  deleted_at   DateTime? // soft delete

  created_at   DateTime  @default(now())
  updated_at   DateTime  @updatedAt

  @@unique([fleet_id, registration])
  @@index([fleet_id, deleted_at])
}
```

### User Model Additions

```prisma
// Add to existing User model:
model User {
  // ... existing fields ...
  fleet_id         String?   // set for FLEET_MANAGER and fleet drivers
  fleet_as_member  Fleet?    @relation("FleetMembers", fields: [fleet_id], references: [id])
  owned_fleet      Fleet?    @relation("FleetOwner")
}
```

### Migration Name

`add_fleet_and_vehicle`

---

## apps/fleet Scaffold

### package.json

```json
{
  "name": "@desert/fleet",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3005",
    "build": "next build",
    "start": "next start --port 3005",
    "lint": "eslint . --max-warnings 0",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@desert/types": "workspace:*",
    "next": "16.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@desert/config": "workspace:*",
    "@types/node": "^22.13.10",
    "@types/react": "^19.0.10",
    "@types/react-dom": "^19.0.4",
    "eslint": "^9.22.0",
    "typescript-eslint": "^8.26.1",
    "tailwindcss": "^4.0.12",
    "@tailwindcss/postcss": "^4.0.12",
    "typescript": "^5.8.3"
  }
}
```

### next.config.ts

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@desert/types'],
};

export default nextConfig;
```

### middleware.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/register']);

interface FleetTokenClaims {
  role?: string;
  exp?: number;
}

function decodeJwtPayload(token: string): FleetTokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload)) as FleetTokenClaims;
  } catch {
    return null;
  }
}

function clearAndRedirect(req: NextRequest): NextResponse {
  const res = NextResponse.redirect(new URL('/login', req.url));
  res.cookies.delete('fleet_token');
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = req.cookies.get('fleet_token')?.value;
  if (!token) return NextResponse.redirect(new URL('/login', req.url));

  const claims = decodeJwtPayload(token);
  if (!claims) return clearAndRedirect(req);

  const nowSec = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp < nowSec) return clearAndRedirect(req);

  if (claims.role !== 'FLEET_MANAGER') return clearAndRedirect(req);

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### lib/fleet-api.ts

```typescript
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export class FleetApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'FleetApiError';
  }
}

export async function fleetFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('fleet_token')?.value ?? '';

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new FleetApiError(res.status, `API ${res.status}: ${text}`);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}
```

### App Structure

```
apps/fleet/
├── app/
│   ├── layout.tsx              # root layout (fonts, metadata)
│   ├── page.tsx                # redirect: /login or /dashboard
│   ├── login/
│   │   ├── page.tsx            # login form (Server Component)
│   │   ├── LoginForm.tsx       # Client Component
│   │   └── actions.ts          # loginAction server action
│   ├── register/
│   │   ├── page.tsx
│   │   ├── RegisterForm.tsx
│   │   └── actions.ts          # registerFleetAction server action
│   └── (fleet)/                # protected route group
│       ├── layout.tsx          # sidebar nav + fleet_token guard
│       ├── dashboard/
│       │   └── page.tsx        # fleet home — stub (filled in 9.3)
│       └── vehicles/
│           ├── page.tsx        # vehicle list
│           ├── VehicleList.tsx
│           ├── AddVehicleForm.tsx
│           └── actions.ts      # addVehicle, editVehicle, deleteVehicle
├── lib/
│   ├── fleet-api.ts
│   └── types.ts                # FleetDto, VehicleDto
├── middleware.ts
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## API Changes

### New Module: FleetModule

**Location:** `apps/api/src/fleet/`

Files:
- `fleet.module.ts`
- `fleet.controller.ts`
- `fleet.service.ts`
- `dto/create-fleet.dto.ts`
- `dto/create-vehicle.dto.ts`
- `dto/update-vehicle.dto.ts`

### FleetController

```typescript
@Controller('v1/fleet')
@UseGuards(AuthGuard, RolesGuard)
export class FleetController {
  // POST /v1/fleet/register
  // @Public() — no role required; creates fleet + sets FLEET_MANAGER role
  // Body: CreateFleetDto { companyName, ownerName, email, password }
  // Returns: { token: string } — sets fleet_token cookie

  // GET /v1/fleet/me
  // @Roles(FLEET_MANAGER)
  // Returns: FleetDto { id, name, subscriptionStatus, trialEndsAt, vehicleCount, memberCount }

  // GET /v1/fleet/vehicles
  // @Roles(FLEET_MANAGER)
  // Returns: VehicleDto[] — active (deleted_at IS NULL), ordered by name

  // POST /v1/fleet/vehicles
  // @Roles(FLEET_MANAGER)
  // Body: CreateVehicleDto
  // Returns: VehicleDto

  // PATCH /v1/fleet/vehicles/:id
  // @Roles(FLEET_MANAGER)
  // Body: UpdateVehicleDto
  // Returns: VehicleDto

  // DELETE /v1/fleet/vehicles/:id
  // @Roles(FLEET_MANAGER)
  // Soft delete: sets deleted_at = now()
  // Returns: 204
}
```

### CreateFleetDto

```typescript
export class CreateFleetDto {
  @IsString() @MinLength(2) @MaxLength(200)
  companyName: string;

  @IsEmail()
  email: string;

  @IsString() @MinLength(8)
  password: string;
}
```

### CreateVehicleDto

```typescript
export class CreateVehicleDto {
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @IsString() @MinLength(2) @MaxLength(20)
  registration: string;

  @IsOptional()
  @IsIn(['PB_95', 'ON', 'PB_98', 'LPG'])
  fuelType?: string;
}
```

### FleetService

```typescript
// registerFleet(dto: CreateFleetDto): Promise<{ token: string }>
//   1. Hash password (bcrypt, same as existing User auth)
//   2. Create User { email, role: FLEET_MANAGER, ... }
//   3. Create Fleet { name: dto.companyName, owner_id: user.id,
//                     trial_ends_at: now() + 30 days, subscription_status: FREE_TRIAL }
//   4. Update User.fleet_id = fleet.id
//   5. Issue JWT { userId, role: FLEET_MANAGER, fleetId: fleet.id }
//      → sign with same JWT_SECRET as existing auth
//   6. Return token (controller sets fleet_token cookie, httpOnly, sameSite=lax)

// getFleet(userId): Promise<FleetDto>
//   Load fleet where owner_id = userId, include _count: { vehicles, members }

// listVehicles(userId): Promise<VehicleDto[]>
//   Load fleet_id from user, then: Vehicle WHERE fleet_id = X AND deleted_at IS NULL ORDER BY name

// createVehicle(userId, dto): Promise<VehicleDto>
//   - Load user.fleet_id
//   - Normalise: registration = dto.registration.toUpperCase().replace(/\s+/g, '')
//   - Check unique [fleet_id, registration] — throw 409 if duplicate
//   - Create Vehicle

// updateVehicle(userId, vehicleId, dto): Promise<VehicleDto>
//   - Load vehicle, verify vehicle.fleet_id === user.fleet_id (ownership)
//   - Apply normalisation to registration if changed
//   - Update

// deleteVehicle(userId, vehicleId): Promise<void>
//   - Ownership check
//   - Set deleted_at = now()
```

### Auth: fleet_token Cookie

The `FleetController.register()` and a `POST /v1/fleet/login` endpoint both set the `fleet_token` cookie:

```typescript
// In FleetController:
@Post('register')
@Public()
async register(@Body() dto: CreateFleetDto, @Res({ passthrough: true }) res: Response) {
  const { token } = await this.fleetService.registerFleet(dto);
  res.cookie('fleet_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,  // 7 days
  });
  return { ok: true };
}

@Post('login')
@Public()
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
  // Verify email/password, check role === FLEET_MANAGER
  // Issue JWT, set cookie
}
```

**JWT payload:**
```typescript
{
  sub: userId,
  role: 'FLEET_MANAGER',
  fleetId: fleet.id,
  exp: now + 7d,
}
```

`fleetId` in the JWT allows `fleetFetch` server actions to avoid an extra DB lookup for the fleet's id.

---

## Partner App Parity Note

Story 7.1 specifies the `apps/partner` scaffold with `partner_token` cookie and `partnerFetch`. Since `apps/partner` doesn't exist yet in the codebase, when a dev builds it they should reference the `apps/fleet` scaffold created in this story (identical pattern, different cookie name and role).

---

## Fleet App — UI Pages

### /register — Registration Form

```tsx
// app/register/RegisterForm.tsx — Client Component
// Fields:
//   Company name (text input)
//   Email (email input)
//   Password (password input, min 8 chars)
//   [Create Fleet Account] button
// On submit: calls registerFleetAction(formData) → redirects to /dashboard
// Show inline errors for duplicate email, weak password
```

### /login — Login Form

Same pattern as `apps/admin/app/login/LoginForm.tsx`. Cookie: `fleet_token`.

### /(fleet)/layout.tsx — Sidebar Nav

Mobile-first sidebar (collapses to bottom nav on mobile):

```tsx
// Nav items (stubs for future stories):
// 🏠 Dashboard     /dashboard
// 🚗 Vehicles      /vehicles
// 📊 Reports       /reports       (Story 9.4 stub)
// 🔔 Alerts        /alerts        (Story 9.5 stub)
// 🗺️  Route         /route         (Story 9.6 stub)
// 🔑 API Access    /api-access    (Story 9.7 stub)
// 💳 Billing       /billing       (Story 9.8 stub)
// ── bottom ──
// Fleet name + subscription badge (FREE TRIAL / ACTIVE)
```

**Mobile-first layout:** On screens < 768px, render a bottom tab bar (4 main items: Dashboard, Vehicles, Reports, Account). On ≥ 768px, render the sidebar. Use Tailwind CSS `md:` breakpoint.

### /(fleet)/vehicles/page.tsx — Vehicle List

```tsx
// Server Component
// Fetches GET /v1/fleet/vehicles via fleetFetch
// Renders:
//   - Page header: "Vehicles (N)" + "Add Vehicle" button
//   - List of VehicleCard items
//   - Empty state: "No vehicles yet. Add your first vehicle."
// VehicleCard shows: name, registration plate badge, fuel type pill, edit/delete buttons
```

### AddVehicleForm

```tsx
// Client Component (inline form, not a separate page)
// Appears below the vehicle list on "Add Vehicle" click
// Fields: name, registration (with live normalisation preview), fuel type select
// On submit: calls addVehicleAction(formData) → revalidatePath('/vehicles')
```

### /(fleet)/dashboard/page.tsx

Stub page for Story 9.3. Shows:
```
Welcome back, [fleet name]
[Trial ends in N days] or [Subscription: Active]
Quick stats: [N] vehicles · [N] drivers · [N] fill-ups this month
→ [View vehicles] [View reports]
```

---

## Turbo + Workspace Registration

Add `apps/fleet` to the Turborepo workspace:

```json
// turbo.json — no changes needed (build/dev/lint pipelines auto-discover all apps)
// package.json (root) — workspaces already include "apps/*" so no change needed
```

Verify `apps/fleet` appears in `turbo run dev` output.

---

## Environment Variables

Add to `apps/fleet/.env.example`:

```bash
API_URL=http://localhost:3001
NEXT_PUBLIC_APP_NAME=desert fleet
```

Add to `apps/api/.env.example`:

```bash
# Fleet JWT (shares JWT_SECRET with existing auth — no new secret needed)
FLEET_TRIAL_DAYS=30
```

---

## Tasks / Subtasks

- [ ] Prisma schema: `Fleet`, `Vehicle`, `FleetSubscriptionStatus` enum, User model additions (AC: all)
  - [ ] Migration `add_fleet_and_vehicle`
  - [ ] `prisma generate`

- [ ] apps/fleet scaffold (AC: 1)
  - [ ] `package.json`, `next.config.ts`, `tsconfig.json`
  - [ ] `middleware.ts` — `fleet_token` + `FLEET_MANAGER` role guard
  - [ ] `lib/fleet-api.ts` — `fleetFetch` helper
  - [ ] `lib/types.ts` — `FleetDto`, `VehicleDto`
  - [ ] Register in Turborepo workspace (verify `turbo run dev` picks it up)

- [ ] FleetModule scaffold (AC: all)
  - [ ] Directory + `fleet.module.ts`
  - [ ] Register in AppModule

- [ ] FleetService — registerFleet (AC: 1)
  - [ ] Create User (FLEET_MANAGER) + Fleet + link fleet_id
  - [ ] Issue JWT with `fleetId` claim
  - [ ] Set `fleet_token` cookie

- [ ] FleetService — login (AC: 1)
  - [ ] Verify email/password, role check
  - [ ] Issue JWT, set cookie

- [ ] FleetController — register + login endpoints (AC: 1)
  - [ ] `POST /v1/fleet/register` (@Public)
  - [ ] `POST /v1/fleet/login` (@Public)
  - [ ] `GET /v1/fleet/me`

- [ ] FleetService + Controller — vehicle CRUD (AC: 3, 4, 5, 6)
  - [ ] `listVehicles()` — active only, ordered by name
  - [ ] `createVehicle()` — normalise registration, unique check
  - [ ] `updateVehicle()` — ownership check, normalise
  - [ ] `deleteVehicle()` — soft delete
  - [ ] `GET /v1/fleet/vehicles`, `POST`, `PATCH /:id`, `DELETE /:id`

- [ ] apps/fleet pages (AC: 1, 3, 4, 5, 6)
  - [ ] `/register` — RegisterForm Client Component + registerFleetAction
  - [ ] `/login` — LoginForm Client Component + loginAction
  - [ ] `/(fleet)/layout.tsx` — mobile-first sidebar/bottom nav
  - [ ] `/(fleet)/dashboard/page.tsx` — stub with quick stats
  - [ ] `/(fleet)/vehicles/page.tsx` — vehicle list
  - [ ] `AddVehicleForm.tsx` — inline add form + addVehicleAction
  - [ ] Edit/delete vehicle actions

---

## Dev Notes

### JWT fleetId Claim vs DB Lookup

`fleetFetch` server actions receive the JWT via `fleet_token` cookie. The `FleetController` can decode `fleetId` from the JWT payload (via `@CurrentUser()` decorator extended to include `fleetId`) to avoid a User → Fleet lookup on every request.

Extend `CurrentUser` decorator / `AuthGuard` payload:
```typescript
// In AuthGuard or a fleet-specific guard:
// After verifying JWT, attach fleetId to req.user:
req.user = { id: userId, role, fleetId: jwtPayload.fleetId };
```

This is a clean optimisation — all fleet-scoped queries use `fleetId` from the JWT, not a DB join through User.

### Registration Plate Normalisation

```typescript
const normalised = dto.registration.toUpperCase().replace(/\s+/g, '');
// 'wa 12345' → 'WA12345'
// 'KR-456AB' → 'KR-456AB' (hyphens preserved — valid in some plate formats)
```

No plate format validation beyond non-empty — Polish, German, Czech, and other EU plates differ in format. Accept any non-empty string up to 20 chars.

### Soft Delete Query Pattern

```typescript
// Always filter deleted_at IS NULL for active vehicle lists:
this.prisma.vehicle.findMany({
  where: { fleet_id: fleetId, deleted_at: null },
  orderBy: { name: 'asc' },
})
```

The `@@index([fleet_id, deleted_at])` on Vehicle ensures this is efficient.

### Mobile-First Layout

The fleet app targets tablet/mobile as primary. Use Tailwind `max-w-lg mx-auto` containers on forms to keep them readable on large screens. Bottom nav on mobile (< md), sidebar on ≥ md:

```tsx
// /(fleet)/layout.tsx
<div className="flex flex-col md:flex-row min-h-screen">
  <nav className="hidden md:flex flex-col w-56 ...">/* sidebar */</nav>
  <main className="flex-1 ...">
    {children}
  </main>
  <nav className="md:hidden fixed bottom-0 w-full ...">/* bottom tabs */</nav>
</div>
```

### Trial Period

`trial_ends_at = now() + FLEET_TRIAL_DAYS * 86400s`. Story 9.8 (Billing) adds subscription purchase. Until 9.8, all fleet features are available without payment gate — the trial badge in the dashboard is informational only.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
