# Story 9.5: Fleet Price Alerts

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.5
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.1 (Fleet model, apps/fleet scaffold), Story 9.3 (FillUp.fleet_id, voivodeship on FillUp via station join), Story 6.1 (BullMQ/alert patterns, ExpoPushProvider)
- **Required by:** None

---

## User Story

**As a fleet manager,**
I want to configure price alerts for my fleet or individual vehicles,
So that I'm notified by email when fuel prices drop below my target threshold at stations in our operating area.

---

## Context & Why

Story 6.1 handles price-drop alerts for individual drivers via Expo push notifications. Fleet managers are a different audience: they use the `apps/fleet` web portal, not the mobile app (which is DRIVER-role only). Expo push tokens are therefore unavailable.

The appropriate channel for fleet managers — B2B business users — is **email**. This story introduces the first email-sending integration in the project (via Resend). Browser push notifications (Web Push API with service workers + VAPID) are deferred to post-MVP.

### Alert Semantics

A `FleetPriceAlert` fires when:
- A station in the fleet's operating voivodeship has a current verified price below `threshold_pln` for the configured `fuel_type`
- AND the alert has not sent in the last 6 hours (dedup by `last_sent_at`)

"Operating voivodeship" is determined by the most recent fill-up station for the fleet. For vehicle-specific alerts, the vehicle's most recent fill-up station is used; if no vehicle fill-ups exist yet, falls back to the fleet-wide voivodeship.

A scheduled BullMQ job runs every 30 minutes and processes all enabled alerts. This is independent of the driver-facing `price-drop-checks` queue.

---

## Acceptance Criteria

**Given** a fleet manager is on the Alerts page
**When** they add a new alert (fuel type + threshold + fleet-wide or specific vehicle)
**Then** the alert appears in their alert list with enabled = true

**Given** a fleet price alert is enabled with `threshold_pln = 7.50` for diesel
**When** the 30-minute check job runs and finds a station in the fleet's voivodeship with diesel price ≤ 7.50
**Then** the fleet owner receives an email with: the best price found, the station name, the fuel type, and the threshold that triggered it
**And** `last_sent_at` is updated to now on the alert record

**Given** an alert was sent less than 6 hours ago
**When** the check job runs again and the condition is still met
**Then** no email is sent (dedup prevents spam)

**Given** a vehicle-specific alert is configured
**When** the check job runs
**Then** the voivodeship used is the vehicle's most recent fill-up station's voivodeship
**And** if the vehicle has no fill-ups, the fleet-wide most recent voivodeship is used as fallback
**And** if no fleet fill-ups exist at all, the alert is skipped silently

**Given** a fleet manager toggles an alert off
**When** the check job runs
**Then** that alert is not checked (enabled = false is excluded from the query)

**Given** a fleet manager deletes an alert
**When** the page reloads
**Then** the alert is gone and the check job no longer evaluates it

---

## New Prisma Model

```prisma
model FleetPriceAlert {
  id            String    @id @default(cuid())
  fleet_id      String
  fleet         Fleet     @relation(fields: [fleet_id], references: [id], onDelete: Cascade)
  vehicle_id    String?   // null = fleet-wide alert
  vehicle       Vehicle?  @relation(fields: [vehicle_id], references: [id], onDelete: Cascade)
  fuel_type     String    // 'PB_95' | 'PB_98' | 'ON' | 'ON_PREMIUM' | 'LPG'
  threshold_pln Decimal   @db.Decimal(5, 2)
  enabled       Boolean   @default(true)
  last_sent_at  DateTime? // dedup: skip if < 6h ago
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  @@index([fleet_id, enabled])
  @@index([vehicle_id])
}
```

**Add to `Fleet` model:**
```prisma
price_alerts  FleetPriceAlert[]
```

**Add to `Vehicle` model:**
```prisma
price_alerts  FleetPriceAlert[]
```

**Migration name:** `add_fleet_price_alert`

---

## Email Infrastructure (New)

This story introduces the first email-sending capability in the project.

### Package

```bash
# Install in apps/api
pnpm add resend
```

**Environment variable:** `RESEND_API_KEY` — add to `apps/api/.env`, Railway env, and `.env.example`.

**Sender address:** `Desert <alerts@desert.app>` — configure in Resend dashboard with DNS records for `desert.app`. For development, use the Resend sandbox sender `onboarding@resend.dev`.

### EmailService

**File:** `apps/api/src/email/email.service.ts` (new)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface FleetPriceAlertEmailParams {
  to: string;                 // fleet owner's email
  fleetName: string;
  fuelType: string;           // display label e.g. 'Diesel'
  thresholdPln: number;
  bestPricePln: number;
  stationName: string;
  voivodeship: string;
  vehicleLabel: string;       // 'Fleet-wide' | 'WA12345 – Van 1'
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend = new Resend(process.env['RESEND_API_KEY']);
  private readonly from = process.env['EMAIL_FROM'] ?? 'Desert <alerts@desert.app>';

  async sendFleetPriceAlert(params: FleetPriceAlertEmailParams): Promise<void> {
    const subject = `Price alert: ${params.fuelType} at ${params.bestPricePln.toFixed(2)} PLN/L`;
    const html = buildFleetAlertHtml(params);

    try {
      await this.resend.emails.send({
        from: this.from,
        to: params.to,
        subject,
        html,
      });
    } catch (err) {
      // Email send failures must never block the worker or crash the job
      this.logger.error(`Failed to send fleet price alert to ${params.to}: ${(err as Error).message}`);
    }
  }
}

function buildFleetAlertHtml(p: FleetPriceAlertEmailParams): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Price Alert</title></head>
<body style="font-family: sans-serif; color: #111; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 8px;">⛽ Price alert: ${p.fuelType}</h2>
  <p style="color: #555; margin: 0 0 20px;">Fleet: <strong>${p.fleetName}</strong> · Scope: ${p.vehicleLabel}</p>

  <table style="width:100%; border-collapse:collapse; margin-bottom:20px;">
    <tr>
      <td style="padding:10px; background:#f3f4f6; border-radius:8px 0 0 8px;">
        <div style="font-size:12px; color:#6b7280;">Current best price</div>
        <div style="font-size:28px; font-weight:700; color:#16a34a;">${p.bestPricePln.toFixed(2)} PLN/L</div>
      </td>
      <td style="padding:10px; background:#f9fafb; border-radius:0 8px 8px 0;">
        <div style="font-size:12px; color:#6b7280;">Your threshold</div>
        <div style="font-size:28px; font-weight:700;">${p.thresholdPln.toFixed(2)} PLN/L</div>
      </td>
    </tr>
  </table>

  <p style="margin:0 0 6px;"><strong>Station:</strong> ${p.stationName}</p>
  <p style="margin:0 0 20px;"><strong>Region:</strong> ${p.voivodeship}</p>

  <hr style="border:none; border-top:1px solid #e5e7eb; margin: 20px 0;">
  <p style="font-size:12px; color:#9ca3af; margin:0;">
    Manage your fleet alerts at <a href="https://fleet.desert.app/alerts" style="color:#2563eb;">fleet.desert.app/alerts</a>
  </p>
</body>
</html>`;
}
```

**File:** `apps/api/src/email/email.module.ts` (new)

```typescript
import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
```

---

## API Changes

### Fleet Alert CRUD Endpoints

**Module:** `FleetModule` (existing, `apps/api/src/fleet/`)

```typescript
// apps/api/src/fleet/fleet.controller.ts

// List alerts for fleet
@Get('alerts')
@Roles(Role.FLEET_MANAGER)
async listAlerts(@CurrentUser() user: JwtPayload): Promise<FleetAlertDto[]> {
  return this.fleetAlertsService.listAlerts(user.fleetId);
}

// Create alert
@Post('alerts')
@Roles(Role.FLEET_MANAGER)
async createAlert(
  @CurrentUser() user: JwtPayload,
  @Body() dto: CreateFleetAlertDto,
): Promise<FleetAlertDto> {
  return this.fleetAlertsService.createAlert(user.fleetId, dto);
}

// Toggle enable/disable
@Patch('alerts/:alertId')
@Roles(Role.FLEET_MANAGER)
async updateAlert(
  @CurrentUser() user: JwtPayload,
  @Param('alertId') alertId: string,
  @Body() dto: UpdateFleetAlertDto,
): Promise<FleetAlertDto> {
  return this.fleetAlertsService.updateAlert(user.fleetId, alertId, dto);
}

// Delete alert
@Delete('alerts/:alertId')
@Roles(Role.FLEET_MANAGER)
@HttpCode(204)
async deleteAlert(
  @CurrentUser() user: JwtPayload,
  @Param('alertId') alertId: string,
): Promise<void> {
  return this.fleetAlertsService.deleteAlert(user.fleetId, alertId);
}
```

**DTOs:**

```typescript
// apps/api/src/fleet/dto/fleet-alert.dto.ts

import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export enum FleetAlertFuelType {
  PB_95 = 'PB_95',
  PB_98 = 'PB_98',
  ON = 'ON',
  ON_PREMIUM = 'ON_PREMIUM',
  LPG = 'LPG',
}

export class CreateFleetAlertDto {
  @IsEnum(FleetAlertFuelType)
  fuelType: FleetAlertFuelType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(20)
  thresholdPln: number;

  @IsOptional()
  @IsString()
  vehicleId?: string;  // null/omitted = fleet-wide
}

export class UpdateFleetAlertDto {
  @IsBoolean()
  enabled: boolean;
}

export class FleetAlertDto {
  id: string;
  fuelType: string;
  thresholdPln: number;
  vehicleId: string | null;
  vehicleLabel: string | null;    // e.g. 'WA12345 – Van 1'; null for fleet-wide
  enabled: boolean;
  lastSentAt: string | null;
  createdAt: string;
}
```

### FleetAlertsService

**File:** `apps/api/src/fleet/fleet-alerts.service.ts` (new)

```typescript
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFleetAlertDto, FleetAlertDto, UpdateFleetAlertDto } from './dto/fleet-alert.dto';

@Injectable()
export class FleetAlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async listAlerts(fleetId: string): Promise<FleetAlertDto[]> {
    const alerts = await this.prisma.fleetPriceAlert.findMany({
      where: { fleet_id: fleetId },
      include: { vehicle: { select: { name: true, registration: true } } },
      orderBy: { created_at: 'asc' },
    });
    return alerts.map(toDto);
  }

  async createAlert(fleetId: string, dto: CreateFleetAlertDto): Promise<FleetAlertDto> {
    // Verify vehicle belongs to fleet if provided
    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, fleet_id: fleetId, deleted_at: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
    }

    const alert = await this.prisma.fleetPriceAlert.create({
      data: {
        fleet_id: fleetId,
        vehicle_id: dto.vehicleId ?? null,
        fuel_type: dto.fuelType,
        threshold_pln: dto.thresholdPln,
      },
      include: { vehicle: { select: { name: true, registration: true } } },
    });
    return toDto(alert);
  }

  async updateAlert(fleetId: string, alertId: string, dto: UpdateFleetAlertDto): Promise<FleetAlertDto> {
    const alert = await this.prisma.fleetPriceAlert.findFirst({
      where: { id: alertId, fleet_id: fleetId },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    const updated = await this.prisma.fleetPriceAlert.update({
      where: { id: alertId },
      data: { enabled: dto.enabled },
      include: { vehicle: { select: { name: true, registration: true } } },
    });
    return toDto(updated);
  }

  async deleteAlert(fleetId: string, alertId: string): Promise<void> {
    const alert = await this.prisma.fleetPriceAlert.findFirst({
      where: { id: alertId, fleet_id: fleetId },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    await this.prisma.fleetPriceAlert.delete({ where: { id: alertId } });
  }
}

function toDto(alert: any): FleetAlertDto {
  const vehicleLabel = alert.vehicle
    ? `${alert.vehicle.registration} – ${alert.vehicle.name}`
    : null;
  return {
    id: alert.id,
    fuelType: alert.fuel_type,
    thresholdPln: parseFloat(alert.threshold_pln.toString()),
    vehicleId: alert.vehicle_id ?? null,
    vehicleLabel,
    enabled: alert.enabled,
    lastSentAt: alert.last_sent_at?.toISOString() ?? null,
    createdAt: alert.created_at.toISOString(),
  };
}
```

---

## Fleet Alert Check Job (BullMQ)

### Queue Constant

```typescript
// apps/api/src/fleet/fleet-alert.constants.ts
export const FLEET_ALERT_CHECKS_QUEUE = 'fleet-alert-checks';
export const FLEET_ALERT_CHECK_JOB_ID = 'fleet-alert-periodic-check';
export const FLEET_ALERT_DEDUP_HOURS = 6;
```

### Worker

**File:** `apps/api/src/fleet/fleet-alert-check.worker.ts` (new)

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { FLEET_ALERT_CHECKS_QUEUE } from './fleet-alert.constants';
import { FleetAlertCheckService } from './fleet-alert-check.service';

@Processor(FLEET_ALERT_CHECKS_QUEUE)
export class FleetAlertCheckWorker extends WorkerHost {
  private readonly logger = new Logger(FleetAlertCheckWorker.name);

  constructor(private readonly service: FleetAlertCheckService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    try {
      await this.service.runChecks();
    } catch (err) {
      this.logger.error('[FLEET-ALERT] Check run failed', (err as Error).stack);
      // Do not rethrow — best-effort, same pattern as price-drop-alert.worker.ts
    }
  }
}
```

### Scheduled Job Registration

In `FleetModule` `onModuleInit`:

```typescript
// apps/api/src/fleet/fleet.module.ts

import { BullModule } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { FLEET_ALERT_CHECKS_QUEUE, FLEET_ALERT_CHECK_JOB_ID } from './fleet-alert.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: FLEET_ALERT_CHECKS_QUEUE }),
    EmailModule,
    // ... existing imports
  ],
  providers: [
    FleetService,
    FleetAlertsService,
    FleetAlertCheckService,
    FleetAlertCheckWorker,
    FleetReportsService,
  ],
})
export class FleetModule implements OnModuleInit {
  constructor(
    @InjectQueue(FLEET_ALERT_CHECKS_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add(
      'check',
      {},
      {
        jobId: FLEET_ALERT_CHECK_JOB_ID,
        repeat: { every: 30 * 60 * 1000 },   // every 30 minutes
        removeOnComplete: { count: 20 },
        removeOnFail: { count: 10 },
      },
    );
  }
}
```

### FleetAlertCheckService

**File:** `apps/api/src/fleet/fleet-alert-check.service.ts` (new)

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { FLEET_ALERT_DEDUP_HOURS } from './fleet-alert.constants';

const FUEL_TYPE_LABELS: Record<string, string> = {
  PB_95: 'Pb 95',
  PB_98: 'Pb 98',
  ON: 'Diesel',
  ON_PREMIUM: 'Premium Diesel',
  LPG: 'LPG',
};

@Injectable()
export class FleetAlertCheckService {
  private readonly logger = new Logger(FleetAlertCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async runChecks(): Promise<void> {
    const dedupCutoff = new Date(Date.now() - FLEET_ALERT_DEDUP_HOURS * 60 * 60 * 1000);

    // Load all enabled alerts not sent in last 6h, with fleet owner email
    const alerts = await this.prisma.fleetPriceAlert.findMany({
      where: {
        enabled: true,
        OR: [
          { last_sent_at: null },
          { last_sent_at: { lt: dedupCutoff } },
        ],
      },
      include: {
        fleet: {
          include: {
            owner: { select: { email: true } },
          },
        },
        vehicle: { select: { name: true, registration: true } },
      },
    });

    if (alerts.length === 0) return;

    this.logger.log(`[FLEET-ALERT] Checking ${alerts.length} alert(s)`);

    for (const alert of alerts) {
      try {
        await this.checkSingleAlert(alert);
      } catch (err) {
        this.logger.error(
          `[FLEET-ALERT] Alert ${alert.id} check failed: ${(err as Error).message}`,
        );
        // Continue to next alert
      }
    }
  }

  private async checkSingleAlert(alert: any): Promise<void> {
    const voivodeship = await this.resolveVoivodeship(alert);
    if (!voivodeship) {
      // No fill-up history — skip silently
      return;
    }

    // Find cheapest station in voivodeship for this fuel type below threshold
    const cheapest = await this.prisma.priceHistory.findFirst({
      where: {
        fuel_type: alert.fuel_type,
        price_pln: { lte: alert.threshold_pln },
        station: { voivodeship },
        is_verified: true,
      },
      orderBy: { price_pln: 'asc' },
      include: { station: { select: { name: true } } },
    });

    if (!cheapest) return;  // No qualifying price found

    // Send email
    const vehicleLabel = alert.vehicle
      ? `${alert.vehicle.registration} – ${alert.vehicle.name}`
      : 'Fleet-wide';

    await this.email.sendFleetPriceAlert({
      to: alert.fleet.owner.email,
      fleetName: alert.fleet.name,
      fuelType: FUEL_TYPE_LABELS[alert.fuel_type] ?? alert.fuel_type,
      thresholdPln: parseFloat(alert.threshold_pln.toString()),
      bestPricePln: parseFloat(cheapest.price_pln.toString()),
      stationName: cheapest.station.name,
      voivodeship,
      vehicleLabel,
    });

    // Update last_sent_at to dedup future sends
    await this.prisma.fleetPriceAlert.update({
      where: { id: alert.id },
      data: { last_sent_at: new Date() },
    });

    this.logger.log(
      `[FLEET-ALERT] Sent alert ${alert.id} (${alert.fuel_type} ≤ ${alert.threshold_pln} PLN, ${voivodeship}) to ${alert.fleet.owner.email}`,
    );
  }

  private async resolveVoivodeship(alert: any): Promise<string | null> {
    // Vehicle-specific: use vehicle's most recent fill-up station voivodeship
    if (alert.vehicle_id) {
      const fillUp = await this.prisma.fillUp.findFirst({
        where: { vehicle_id: alert.vehicle_id },
        orderBy: { filled_at: 'desc' },
        include: { station: { select: { voivodeship: true } } },
      });
      if (fillUp?.station?.voivodeship) return fillUp.station.voivodeship;
      // Fall through to fleet-wide if no vehicle fill-ups
    }

    // Fleet-wide: use fleet's most recent fill-up station voivodeship
    const fillUp = await this.prisma.fillUp.findFirst({
      where: { fleet_id: alert.fleet_id },
      orderBy: { filled_at: 'desc' },
      include: { station: { select: { voivodeship: true } } },
    });
    return fillUp?.station?.voivodeship ?? null;
  }
}
```

**Note on `PriceHistory` query:** The `is_verified` flag and `priceHistory → station` relation must exist. Cross-check with Story 3.x (price submission) to confirm the `voivodeship` column on `Station` and `is_verified` on `PriceHistory`. If `is_verified` doesn't exist, use the most recent entry per station (ordered by `created_at desc`).

---

## Fleet App Changes

### Alerts Page

**File:** `apps/fleet/app/(fleet)/alerts/page.tsx` (new — Server Component)

```tsx
import { fleetFetch } from '../../../lib/fleet-api';
import AlertList from './AlertList';
import AddAlertForm from './AddAlertForm';

export const metadata = { title: 'Price Alerts' };

async function getAlerts() {
  try {
    return await fleetFetch<FleetAlertDto[]>('/v1/fleet/alerts');
  } catch {
    return [];
  }
}

async function getVehicles() {
  try {
    return await fleetFetch<{ id: string; name: string; registration: string }[]>('/v1/fleet/vehicles');
  } catch {
    return [];
  }
}

export default async function AlertsPage() {
  const [alerts, vehicles] = await Promise.all([getAlerts(), getVehicles()]);

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Price Alerts</h1>
        <p className="text-sm text-gray-500 mt-1">
          Get emailed when fuel prices drop below your target in your operating area.
        </p>
      </div>

      <AddAlertForm vehicles={vehicles} />
      <AlertList alerts={alerts} />
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/alerts/actions.ts` (new)

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { fleetFetch } from '../../../lib/fleet-api';

export async function createAlertAction(formData: FormData) {
  const fuelType = formData.get('fuelType') as string;
  const thresholdPln = parseFloat(formData.get('thresholdPln') as string);
  const vehicleId = (formData.get('vehicleId') as string) || undefined;

  await fleetFetch('/v1/fleet/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fuelType, thresholdPln, vehicleId }),
  });
  revalidatePath('/alerts');
}

export async function toggleAlertAction(alertId: string, enabled: boolean) {
  await fleetFetch(`/v1/fleet/alerts/${alertId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  revalidatePath('/alerts');
}

export async function deleteAlertAction(alertId: string) {
  await fleetFetch(`/v1/fleet/alerts/${alertId}`, { method: 'DELETE' });
  revalidatePath('/alerts');
}
```

**File:** `apps/fleet/app/(fleet)/alerts/AddAlertForm.tsx` (new Client Component)

```tsx
'use client';

import { useTransition } from 'react';
import { createAlertAction } from './actions';

const FUEL_TYPES = [
  { value: 'PB_95', label: 'Pb 95' },
  { value: 'PB_98', label: 'Pb 98' },
  { value: 'ON', label: 'Diesel' },
  { value: 'ON_PREMIUM', label: 'Premium Diesel' },
  { value: 'LPG', label: 'LPG' },
];

interface Props {
  vehicles: { id: string; name: string; registration: string }[];
}

export default function AddAlertForm({ vehicles }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => startTransition(() => createAlertAction(formData))}
      className="space-y-4 p-4 border border-gray-200 rounded-xl bg-gray-50"
    >
      <h2 className="text-sm font-semibold text-gray-700">New alert</h2>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Fuel type</label>
          <select name="fuelType" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
            {FUEL_TYPES.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Alert when below (PLN/L)</label>
          <input
            name="thresholdPln"
            type="number"
            step="0.01"
            min="1"
            max="20"
            required
            placeholder="e.g. 7.50"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Scope</label>
        <select name="vehicleId" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Fleet-wide</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registration} – {v.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add alert'}
      </button>
    </form>
  );
}
```

**File:** `apps/fleet/app/(fleet)/alerts/AlertList.tsx` (new Client Component)

```tsx
'use client';

import { useTransition } from 'react';
import { toggleAlertAction, deleteAlertAction } from './actions';

interface FleetAlertDto {
  id: string;
  fuelType: string;
  thresholdPln: number;
  vehicleLabel: string | null;
  enabled: boolean;
  lastSentAt: string | null;
}

const FUEL_LABELS: Record<string, string> = {
  PB_95: 'Pb 95', PB_98: 'Pb 98', ON: 'Diesel', ON_PREMIUM: 'Premium Diesel', LPG: 'LPG',
};

export default function AlertList({ alerts }: { alerts: FleetAlertDto[] }) {
  const [pending, startTransition] = useTransition();

  if (alerts.length === 0) {
    return (
      <p className="text-sm text-gray-400 text-center py-8">
        No alerts configured. Add one above to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {alerts.map((alert) => (
        <li key={alert.id} className="flex items-center gap-3 py-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">
              {FUEL_LABELS[alert.fuelType] ?? alert.fuelType} ≤ {alert.thresholdPln.toFixed(2)} PLN/L
            </div>
            <div className="text-xs text-gray-500">
              {alert.vehicleLabel ?? 'Fleet-wide'}
              {alert.lastSentAt && ` · Last sent ${new Date(alert.lastSentAt).toLocaleDateString()}`}
            </div>
          </div>

          {/* Enable/disable toggle */}
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => toggleAlertAction(alert.id, !alert.enabled))}
            className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
              alert.enabled ? 'bg-gray-900' : 'bg-gray-300'
            }`}
            aria-label={alert.enabled ? 'Disable alert' : 'Enable alert'}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                alert.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>

          {/* Delete button */}
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => deleteAlertAction(alert.id))}
            className="text-gray-400 hover:text-red-500 text-xs px-2 py-1"
            aria-label="Delete alert"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
```

### Navigation — Add Alerts Tab

In `apps/fleet/app/(fleet)/layout.tsx`, add the Alerts link to the nav items array (following the same pattern as Story 9.4's Reports link):

```tsx
{ href: '/alerts', label: 'Alerts', icon: BellIcon },
```

---

## Migration

**Name:** `add_fleet_price_alert`

```sql
-- CreateTable
CREATE TABLE "FleetPriceAlert" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "fuel_type" TEXT NOT NULL,
    "threshold_pln" DECIMAL(5,2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetPriceAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FleetPriceAlert_fleet_id_enabled_idx" ON "FleetPriceAlert"("fleet_id", "enabled");
CREATE INDEX "FleetPriceAlert_vehicle_id_idx" ON "FleetPriceAlert"("vehicle_id");

ALTER TABLE "FleetPriceAlert" ADD CONSTRAINT "FleetPriceAlert_fleet_id_fkey"
  FOREIGN KEY ("fleet_id") REFERENCES "Fleet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FleetPriceAlert" ADD CONSTRAINT "FleetPriceAlert_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

---

## Tasks / Subtasks

- [ ] API: Prisma schema — `FleetPriceAlert` model + relations on `Fleet` and `Vehicle` (AC: 1)
  - [ ] Migration: `add_fleet_price_alert`

- [ ] API: `EmailModule` + `EmailService` (AC: 2)
  - [ ] `pnpm add resend` in `apps/api`
  - [ ] `EmailService.sendFleetPriceAlert()` with HTML template
  - [ ] Swallow send errors (log only) — never block worker
  - [ ] `RESEND_API_KEY` + `EMAIL_FROM` env vars in `.env.example`

- [ ] API: `FleetAlertsService` — CRUD (AC: 1, 5, 6)
  - [ ] `listAlerts`, `createAlert`, `updateAlert`, `deleteAlert`
  - [ ] Vehicle ownership check in `createAlert`
  - [ ] `toDto()` helper with `vehicleLabel`

- [ ] API: `FleetController` — 4 alert endpoints (AC: 1, 5, 6)
  - [ ] `@Roles(Role.FLEET_MANAGER)` on all

- [ ] API: `FLEET_ALERT_CHECKS_QUEUE` constant + scheduled job registration in `FleetModule.onModuleInit` (AC: 2, 3)
  - [ ] `repeat: { every: 30 * 60 * 1000 }`, stable `jobId`

- [ ] API: `FleetAlertCheckService.runChecks()` (AC: 2, 3, 4, 5)
  - [ ] Load enabled alerts with `last_sent_at < 6h ago` filter
  - [ ] `resolveVoivodeship()` — vehicle fill-up → fleet fill-up fallback → null skip
  - [ ] `PriceHistory` query: fuel_type + threshold + station voivodeship + verified
  - [ ] Call `EmailService.sendFleetPriceAlert()` on match
  - [ ] Update `last_sent_at` after send

- [ ] API: `FleetAlertCheckWorker` (AC: 2)
  - [ ] `@Processor(FLEET_ALERT_CHECKS_QUEUE)`, best-effort error handling (no rethrow)

- [ ] API: Register `FleetAlertsService`, `FleetAlertCheckService`, `FleetAlertCheckWorker`, `EmailModule` in `FleetModule`

- [ ] Fleet app: `/alerts` page — `page.tsx` (Server), `AddAlertForm.tsx` (Client), `AlertList.tsx` (Client), `actions.ts`
  - [ ] Add/toggle/delete alerts (AC: 1, 5, 6)

- [ ] Fleet app: Add Alerts nav link in `(fleet)/layout.tsx`

---

## Dev Notes

### No Push for MVP — Web Portal Context

Fleet managers use `apps/fleet` (a web app). Expo push tokens are only collected in the mobile app (DRIVER role). **Browser push notifications** (Web Push API with service workers + VAPID keys) are non-trivial to implement and are deferred to post-MVP. Email covers the business need for MVP — fleet managers check email regularly and expect formal business communication.

### Resend Free Tier

Resend offers 3,000 emails/month free and 100/day. For a fleet fleet of 10–50 managers with ≤10 alerts each, a 30-minute check cadence could generate at most a few emails per day (dedup prevents more). Easily within free tier for MVP. The `RESEND_API_KEY` needs to be provisioned and domain DNS configured before the first email send.

### `PriceHistory` Query — `is_verified` Field

The query in `FleetAlertCheckService` uses `is_verified: true`. Verify this field exists on `PriceHistory` in the schema (Story 3.x). If the field is named differently (e.g. `verified`, `status = 'VERIFIED'`), adjust accordingly. The intent is to only fire alerts on confirmed prices, not unconfirmed submissions.

### 6-Hour Dedup via Database Field

Unlike driver alerts (which use Redis TTL dedup keys), fleet alerts use `last_sent_at` on the database record. This is simpler (no Redis dependency in the fleet alert path) and appropriate at this scale. Redis dedup would be needed if fleet alerts scaled to thousands of fleets — at that point replace the `OR: [{ last_sent_at: null }, { last_sent_at: { lt: dedupCutoff } }]` filter with a Redis `SET NX EX` pattern.

### Alert Scope — Voivodeship Only (MVP)

The voivodeship-level scope is coarser than the PostGIS radius check used for driver alerts. Fleet vehicles operate regionally, making voivodeship-level appropriate for MVP. Post-MVP: add `radius_km` field to `FleetPriceAlert` and switch to PostGIS `ST_DWithin` using the vehicle's last fill-up station coordinates.

### `PriceHistory` Currency and Most-Recent Price

The `PriceHistory` query returns the cheapest verified price for the fuel type in the voivodeship without filtering by recency. This means a very old verified price (e.g. from 6 months ago) could trigger an alert if no newer prices have been submitted. Add `created_at: { gte: subDays(new Date(), 30) }` to the query if stale-price false positives occur during testing.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
