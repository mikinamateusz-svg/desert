# Story 9.3: Fleet Dashboard & Cost Analytics

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.3
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (`Fleet`, `Vehicle` models), Story 9.2 (`VehicleAssignment`), Story 5.2 (`FillUp.vehicle_id`, `FillUp.total_cost_pln`, `FillUp.litres`, `FillUp.price_per_litre_pln`), Story 5.3 (`FillUp.area_avg_at_fillup`), Story 5.4 (`FillUp.consumption_l_per_100km`)
- **Required by:** Story 9.4 (exports same data as CSV/PDF)

---

## User Story

**As a fleet manager,**
I want a dashboard showing per-vehicle fuel cost history and consumption,
So that I can identify which vehicles are over-spending and take action.

---

## Context & Why

The `FillUp` model (Story 5.2) already stores `vehicle_id`, `total_cost_pln`, `litres`, `price_per_litre_pln`, `area_avg_at_fillup` (Story 5.3), and `consumption_l_per_100km` (Story 5.4). The fleet dashboard aggregates these into a cost view scoped to the fleet manager's vehicles.

### Fill-Up Attribution to Fleet Vehicles

When a **fleet driver** records a fill-up in the mobile app, Story 5.2's recording flow currently sets `vehicle_id` from the driver's **personal vehicle** (Story 5.1). For fleet members, it must use the **active `VehicleAssignment`** vehicle instead.

This story adds a hook to the fill-up recording path: if `user.fleet_id IS NOT NULL`, look up `VehicleAssignment WHERE driver_id = userId AND unassigned_at IS NULL` to get the fleet vehicle id. If no active assignment, fall back to the personal vehicle.

This change is made in `FillUpService` (or wherever Story 5.2 creates `FillUp` records) — a small extension, not a rewrite.

### fleet_id Denormalisation

`FillUp` gets a `fleet_id` field (nullable). Set at write time when `user.fleet_id IS NOT NULL`. This allows efficient fleet-wide queries without joining through `Vehicle → Fleet`.

---

## Acceptance Criteria

**Given** a fleet manager opens the Dashboard
**When** they view it
**Then** they see a fleet totals header: total spend (PLN), total litres, fill-up count, and average fleet consumption (l/100km) for the selected period
**And** below the header, per-vehicle cards are shown for all active fleet vehicles

**Given** a fleet manager views a vehicle card
**When** they inspect it
**Then** they see: vehicle name + registration, total spend (PLN), total litres, fill-up count, average l/100km, current assigned driver name (if any)
**And** if `area_avg_at_fillup` data is available: savings vs. regional average shown as "+N.NN PLN saved" (green) or "-N.NN PLN above avg" (amber)

**Given** a fleet manager selects a period filter
**When** they choose 7 days / 30 days / 90 days / current month
**Then** all metrics on the dashboard recalculate for that period

**Given** a fleet manager taps a vehicle card
**When** they open the vehicle detail view
**Then** they see the vehicle's individual fill-up history list (date, station name, litres, cost, driver) and a simple consumption trend (last 5 fill-ups with l/100km where available)

**Given** a fleet vehicle has no fill-ups in the selected period
**When** the vehicle card renders
**Then** it shows "No fill-ups in this period" — it is still shown (not hidden) so managers know which vehicles are inactive

**Given** a fleet driver records a fill-up in the mobile app
**When** they have an active `VehicleAssignment`
**Then** the `FillUp` record is attributed to their assigned fleet vehicle (not their personal vehicle)
**And** `FillUp.fleet_id` is set to `user.fleet_id`

---

## Schema Changes

### FillUp Model Addition

```prisma
// Add to FillUp model (migration: add_fillup_fleet_attribution):
model FillUp {
  // ... existing fields from Stories 5.2, 5.3, 5.4 ...
  fleet_id  String?   // denormalized — set when driver has fleet_id at fill-up time
  fleet     Fleet?    @relation(fields: [fleet_id], references: [id], onDelete: SetNull)

  @@index([fleet_id, filled_at(sort: Desc)])  // add alongside existing indexes
}
```

### Migration Name

`add_fillup_fleet_attribution`

---

## API Changes

### FleetController Additions

```typescript
// GET /v1/fleet/analytics/dashboard?period=7d|30d|90d|month
// @Roles(FLEET_MANAGER)
// Returns: FleetDashboardDto

// GET /v1/fleet/analytics/vehicles/:vehicleId?period=7d|30d|90d|month
// @Roles(FLEET_MANAGER) + ownership check (vehicle.fleet_id === manager's fleet)
// Returns: VehicleDetailDto (fill-up history list + consumption trend)
```

### Response DTOs

```typescript
// apps/api/src/fleet/dto/fleet-dashboard.dto.ts

export class FleetDashboardDto {
  period: { start: string; end: string };
  totals: {
    totalSpendPln: number;
    totalLitres: number;
    fillUpCount: number;
    avgConsumptionL100km: number | null;  // null if no consumption data
    totalSavingsPln: number | null;       // null if no area_avg data
  };
  vehicles: VehicleAnalyticsDto[];
}

export class VehicleAnalyticsDto {
  vehicleId: string;
  vehicleName: string;
  registration: string;
  totalSpendPln: number;
  totalLitres: number;
  fillUpCount: number;
  avgConsumptionL100km: number | null;
  savingsVsAvgPln: number | null;
  currentDriver: { id: string; displayName: string | null } | null;
  hasData: boolean;  // false if fillUpCount === 0
}

export class VehicleDetailDto {
  vehicle: { id: string; name: string; registration: string };
  period: { start: string; end: string };
  fillUps: VehicleFillUpRow[];
  consumptionTrend: ConsumptionPoint[];  // last 5 fill-ups with consumption data
}

export class VehicleFillUpRow {
  id: string;
  filledAt: string;
  stationName: string | null;
  fuelType: string;
  litres: number;
  totalCostPln: number;
  pricePerLitrePln: number;
  areaAvgAtFillup: number | null;
  consumptionL100km: number | null;
  driverName: string | null;  // user.display_name at fill-up time (from user_id join)
}

export class ConsumptionPoint {
  filledAt: string;
  consumptionL100km: number;
}
```

### FleetAnalyticsService

```typescript
// apps/api/src/fleet/fleet-analytics.service.ts

// resolvePeriod(period: string): { start: Date; end: Date }
//   '7d'    → last 7 calendar days
//   '30d'   → last 30 calendar days
//   '90d'   → last 90 calendar days
//   'month' → 1st of current month to now
//   default → '30d'

// getDashboard(fleetId: string, period: string): Promise<FleetDashboardDto>
//
// Step 1: Load all active vehicles for fleet
//   vehicles = prisma.vehicle.findMany({ where: { fleet_id: fleetId, deleted_at: null } })
//
// Step 2: Load current assignments for all vehicles (batch)
//   assignments = prisma.vehicleAssignment.findMany({
//     where: { vehicle_id: { in: vehicleIds }, unassigned_at: null },
//     include: { driver: { select: { id: true, display_name: true } } }
//   })
//   assignmentByVehicle = Map(vehicleId → assignment)
//
// Step 3: Aggregate fill-up metrics per vehicle (single query)
//   rows = await prisma.$queryRaw<VehicleAggRow[]>`
//     SELECT
//       vehicle_id,
//       COUNT(*)::int                              AS fill_up_count,
//       COALESCE(SUM(total_cost_pln), 0)           AS total_spend,
//       COALESCE(SUM(litres), 0)                   AS total_litres,
//       AVG(consumption_l_per_100km)               AS avg_consumption,
//       SUM((area_avg_at_fillup - price_per_litre_pln) * litres)
//                                                  AS total_savings
//     FROM "FillUp"
//     WHERE fleet_id = ${fleetId}
//       AND filled_at >= ${start}
//       AND filled_at < ${end}
//     GROUP BY vehicle_id
//   `
//
// Step 4: Build fleet totals (sum over all vehicles from rows)
//
// Step 5: Merge vehicles + metrics + current assignments → VehicleAnalyticsDto[]
//   Vehicles with no rows get hasData: false
//
// Step 6: Return FleetDashboardDto

// getVehicleDetail(fleetId: string, vehicleId: string, period: string): Promise<VehicleDetailDto>
//   - Ownership check: vehicle.fleet_id === fleetId
//   - Load fill-ups in period with user join (for driverName)
//   - Load last 5 fill-ups with consumption_l_per_100km IS NOT NULL for trend
//   - Return VehicleDetailDto
```

---

## Fill-Up Attribution Hook

### In FillUpService (Story 5.2 location)

Extend `createFillUp()` to handle fleet attribution:

```typescript
// apps/api/src/fillup/fillup.service.ts
// In createFillUp(userId, dto):

// After loading user:
let effectiveVehicleId = dto.vehicleId;  // personal vehicle (Story 5.1 default)
let fleetId: string | null = null;

if (user.fleet_id) {
  fleetId = user.fleet_id;
  // Look up active fleet vehicle assignment
  const assignment = await this.prisma.vehicleAssignment.findFirst({
    where: { driver_id: userId, unassigned_at: null },
    select: { vehicle_id: true },
  });
  if (assignment) {
    effectiveVehicleId = assignment.vehicle_id;
  }
  // If no assignment: fall back to personal vehicle (effectiveVehicleId unchanged)
}

// Create FillUp:
await this.prisma.fillUp.create({
  data: {
    // ... existing fields ...
    vehicle_id: effectiveVehicleId,
    fleet_id: fleetId,
  },
});
```

This is a **small, additive change** to Story 5.2's service — 10 lines. The fleet vehicle takes precedence over the personal vehicle when an active assignment exists.

---

## Partner App — Dashboard UI

### /(fleet)/dashboard/page.tsx — Replace Stub

```tsx
// Server Component
// Fetches GET /v1/fleet/analytics/dashboard?period=30d via fleetFetch
// Default period: 30d

// Layout:
// ┌──────────────────────────────────────────────┐
// │  Period picker: [7d] [30d] [90d] [Month]     │
// ├──────────────────────────────────────────────┤
// │  Fleet totals card (full width)              │
// │  Total spend: 3,420.50 PLN                   │
// │  Total litres: 892 L · Fill-ups: 47          │
// │  Avg consumption: 8.4 l/100km                │
// │  Savings vs avg: +124.30 PLN                 │
// ├──────────────────────────────────────────────┤
// │  [Vehicle card] [Vehicle card] [Vehicle card]│
// │  (grid: 1 col mobile, 2 col md, 3 col lg)    │
// └──────────────────────────────────────────────┘
```

### Period Picker

Client Component — changes the `period` query parameter and re-fetches:

```tsx
// PeriodPicker.tsx — Client Component
// Renders 4 buttons (tab-style): 7d / 30d / 90d / Month
// On click: router.push(`/dashboard?period=${p}`) — triggers page Server Component re-render
// Active button highlighted
```

### VehicleCard Component

```tsx
// VehicleCard.tsx — Server Component (receives VehicleAnalyticsDto as prop)
// Mobile-first card design:
//
// ┌─────────────────────────────────┐
// │  🚗  Company Van 1  WA12345    │
// │  Driver: Jan Kowalski           │
// ├─────────────────────────────────┤
// │  Spend: 720.40 PLN              │
// │  Litres: 187 L  ·  7 fill-ups  │
// │  Avg: 8.1 l/100km               │
// │  +24.50 PLN vs avg  ✓           │  ← green if savings > 0
// ├─────────────────────────────────┤
// │  [View details →]               │
// └─────────────────────────────────┘
//
// When hasData === false:
// │  No fill-ups in this period     │  (neutral state, card still shown)
```

Tapping "View details →" navigates to `/(fleet)/vehicles/[id]/page.tsx`.

### /(fleet)/vehicles/[id]/page.tsx — Vehicle Detail

```tsx
// Server Component
// Fetches GET /v1/fleet/analytics/vehicles/:id?period=30d
// Layout:
//   Header: vehicle name + registration + current driver
//   Period picker (same component as dashboard)
//   Fill-up history table (mobile: stacked cards, desktop: table)
//   Consumption trend: simple line of last 5 l/100km values
//     (rendered as: "8.1 → 8.4 → 7.9 → 8.2 → 8.0 l/100km" text line for MVP)
//     Post-MVP: proper chart (Recharts or Chart.js)
```

### Fill-Up History Table

```
Date          Station           Fuel    Litres  Cost     Driver
7 Apr 2026   ORLEN Warszawa    PB95    45.2 L  284.50 ₽ Jan K.
5 Apr 2026   BP Kraków         ON      62.0 L  435.80 ₽ Anna W.
...
```

Mobile layout: each row as a card with all fields stacked vertically.

---

## Tasks / Subtasks

- [ ] Prisma: Add `fleet_id` to `FillUp` + Fleet relation (AC: 6)
  - [ ] Migration `add_fillup_fleet_attribution`
  - [ ] `prisma generate`

- [ ] FillUp attribution hook (AC: 6)
  - [ ] In `createFillUp()`: if user.fleet_id → look up active VehicleAssignment → set vehicle_id + fleet_id
  - [ ] Fallback to personal vehicle if no assignment

- [ ] FleetAnalyticsService (AC: 1, 2, 3, 4, 5)
  - [ ] `resolvePeriod()` helper
  - [ ] `getDashboard()` — raw SQL aggregate query + vehicle merge
  - [ ] `getVehicleDetail()` — fill-ups with driver join + trend

- [ ] FleetController: analytics endpoints (AC: 1, 3, 4)
  - [ ] `GET /v1/fleet/analytics/dashboard?period=`
  - [ ] `GET /v1/fleet/analytics/vehicles/:id?period=`

- [ ] apps/fleet: dashboard page (AC: 1, 2, 3, 5)
  - [ ] Replace stub `/dashboard/page.tsx`
  - [ ] Fleet totals header card
  - [ ] Vehicle card grid (1/2/3 col breakpoints)
  - [ ] `PeriodPicker` Client Component
  - [ ] `VehicleCard` component (with savings display)

- [ ] apps/fleet: vehicle detail page (AC: 4)
  - [ ] `/(fleet)/vehicles/[id]/page.tsx`
  - [ ] Fill-up history (cards on mobile, table on desktop)
  - [ ] Consumption trend text display

---

## Dev Notes

### Raw SQL Aggregate — Prisma.$queryRaw

Prisma's `groupBy` cannot aggregate across nullable floats with custom expressions (savings = `(area_avg - price) * litres`). Use `prisma.$queryRaw` for the main dashboard aggregate. Tag the query type explicitly:

```typescript
interface VehicleAggRow {
  vehicle_id: string;
  fill_up_count: number;
  total_spend: string;   // Postgres returns NUMERIC as string
  total_litres: string;
  avg_consumption: string | null;
  total_savings: string | null;
}
```

Parse string numerics with `parseFloat()` before returning from service. Never return raw Postgres types to the controller.

### Vehicles With No Fill-Ups

The aggregate query only returns rows for vehicles that have fill-ups in the period. After the query, merge with the full vehicle list from Step 1:

```typescript
const metricsByVehicle = new Map(rows.map(r => [r.vehicle_id, r]));
return vehicles.map(v => ({
  ...v,
  hasData: metricsByVehicle.has(v.id),
  ...(metricsByVehicle.get(v.id) ?? defaultZeroMetrics),
}));
```

### Savings Null Handling

`total_savings` is null when no fill-up in the period has a non-null `area_avg_at_fillup`. This happens for stations where no regional benchmark existed at fill-up time (Story 5.3 requirement). Display as "N/A" in the UI — never show 0 savings when data is missing.

### Consumption Trend — MVP Text Display

A line chart requires a charting library (Recharts, Victory, Chart.js). For MVP, display the last 5 l/100km values as a text sequence: `"8.1 → 8.4 → 7.9 l/100km"`. Add a proper chart in a follow-up if user testing shows demand. This keeps the bundle lean and avoids a charting dependency in 9.3.

### Period = 'month' Boundary

'month' means the current calendar month (1st to today, inclusive). Use Warsaw timezone for boundary:

```typescript
// Warsaw = UTC+1 (winter) / UTC+2 (summer)
// For MVP: use UTC (close enough; off by 1-2 hours at month boundaries)
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), 1);  // 1st of month, midnight UTC
```

Post-MVP: use `date-fns-tz` with `Europe/Warsaw` timezone for precise boundary.

### FleetAnalyticsService Location

Add to the existing `FleetModule` as a second provider:

```typescript
@Module({
  // ...
  providers: [FleetService, FleetAnalyticsService, FleetEmailService],
  exports: [FleetService],
})
export class FleetModule {}
```

`FleetAnalyticsService` injects `PrismaService` only — no cross-module dependencies.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
