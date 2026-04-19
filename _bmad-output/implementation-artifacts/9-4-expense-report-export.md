# Story 9.4: Expense Report Export

## Metadata
- **Epic:** 9 — Fleet Subscription Tier
- **Story ID:** 9.4
- **Status:** ready-for-dev
- **Date:** 2026-04-08
- **Depends on:** Story 9.3 (FillUp.fleet_id, FleetAnalyticsService, fleet dashboard data model), Story 9.1 (Fleet model, fleetFetch helper, apps/fleet scaffold)
- **Required by:** None

---

## User Story

**As a fleet manager,**
I want to export fuel expense reports as CSV or PDF,
So that I can submit accurate cost records to accounting and reimburse drivers correctly.

---

## Context & Why

Story 9.3 built the live dashboard — this story turns the same underlying data into portable documents. The fleet manager needs to hand something to an accountant or upload to an ERP: a PDF for formal reporting, a CSV for spreadsheet import.

Both formats cover the same data set: fill-ups in the selected period, with optional grouping by vehicle or by driver. Grouping affects sort order and whether subtotals appear in the PDF. The CSV is always flat (one row per fill-up) regardless of grouping.

### No R2 Storage

Billing invoices (Story 8.4) are stored in R2 permanently for legal compliance. Expense reports are not financial documents — they're operational exports. They are generated on-demand and streamed directly to the browser. No storage, no download-link expiry logic.

### Download Mechanism

The fleet app is a Next.js app; the backend API requires `Authorization: Bearer {token}` (not a browser-native cookie). A direct `<a href="...">` pointing at the backend API would not include the auth header.

Solution: a Next.js route handler at `apps/fleet/app/api/export/route.ts` reads the `fleet_token` httpOnly cookie, adds the `Authorization` header, and proxies the backend response (including `Content-Disposition`) directly to the browser. The fleet app UI triggers this route handler via a standard anchor tag with query params.

---

## Acceptance Criteria

**Given** a fleet manager is on the Reports page
**When** they select a period and click "Export CSV"
**Then** a `.csv` file downloads with one row per fill-up, columns: Date, Vehicle, Registration, Driver, Station, Fuel Type, Litres, Price/L (PLN), Total (PLN), Regional Avg/L (PLN), Savings vs Avg (PLN)
**And** savings is blank (empty cell) when no regional average was available at fill-up time

**Given** a fleet manager clicks "Export PDF"
**When** the file downloads
**Then** the PDF includes: fleet name, period, generated date, summary totals (total spend, total litres, avg price/L, total savings), and a fill-up detail table
**And** if "Group by vehicle" was selected, the table has a subtotal row after each vehicle's fill-ups
**And** if "Group by driver" was selected, the table has a subtotal row after each driver's fill-ups

**Given** a fleet manager selects "Last month" as the period
**When** the export runs
**Then** the data covers exactly the calendar month prior to the current month

**Given** the fleet has no fill-ups in the selected period
**When** the manager exports in either format
**Then** the CSV contains only the header row
**And** the PDF contains the summary section with all zeros and an empty table with the header row

**Given** the `fleet_token` cookie is absent or expired
**When** the export route handler is called
**Then** it returns HTTP 401 and no file is served

---

## API Changes

### New Endpoint: GET /v1/fleet/reports/export

**Module:** `FleetModule` (existing, `apps/api/src/fleet/`)

```typescript
// apps/api/src/fleet/fleet.controller.ts

@Get('reports/export')
@Roles(Role.FLEET_MANAGER)
@Header('Cache-Control', 'no-store')
async exportReport(
  @CurrentUser() user: JwtPayload,
  @Query() query: ExportQueryDto,
  @Res() res: Response,
): Promise<void> {
  const { buffer, filename, contentType } =
    await this.fleetReportsService.generateExport(user.fleetId, query);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
}
```

**DTO:**

```typescript
// apps/api/src/fleet/dto/export-query.dto.ts
import { IsEnum, IsOptional } from 'class-validator';

export enum ExportFormat {
  CSV = 'csv',
  PDF = 'pdf',
}

export enum ExportGroupBy {
  NONE = 'none',
  VEHICLE = 'vehicle',
  DRIVER = 'driver',
}

export enum ExportPeriod {
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  NINETY_DAYS = '90d',
  CURRENT_MONTH = 'month',
  LAST_MONTH = 'lastmonth',
}

export class ExportQueryDto {
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @IsOptional()
  @IsEnum(ExportGroupBy)
  groupBy: ExportGroupBy = ExportGroupBy.NONE;

  @IsOptional()
  @IsEnum(ExportPeriod)
  period: ExportPeriod = ExportPeriod.THIRTY_DAYS;
}
```

---

## FleetReportsService

**File:** `apps/api/src/fleet/fleet-reports.service.ts` (new)

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExportFormat, ExportGroupBy, ExportQueryDto, ExportPeriod } from './dto/export-query.dto';
import PDFDocument from 'pdfkit';
import path from 'path';

interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

interface FillUpRow {
  filledAt: Date;
  vehicleName: string | null;
  vehicleRegistration: string | null;
  driverName: string | null;
  stationName: string | null;
  fuelType: string;
  litres: number;
  pricePerLitrePln: number;
  totalCostPln: number;
  areaAvgAtFillup: number | null;
}

@Injectable()
export class FleetReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolvePeriod(period: ExportPeriod): { start: Date; end: Date } {
    const now = new Date();
    switch (period) {
      case ExportPeriod.SEVEN_DAYS: {
        const start = new Date(now);
        start.setDate(start.getDate() - 7);
        return { start, end: now };
      }
      case ExportPeriod.NINETY_DAYS: {
        const start = new Date(now);
        start.setDate(start.getDate() - 90);
        return { start, end: now };
      }
      case ExportPeriod.CURRENT_MONTH: {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start, end: now };
      }
      case ExportPeriod.LAST_MONTH: {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 1);  // midnight of 1st of current month
        return { start, end };
      }
      default: {  // '30d'
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        return { start, end: now };
      }
    }
  }

  private async fetchFillUps(
    fleetId: string,
    start: Date,
    end: Date,
    groupBy: ExportGroupBy,
  ): Promise<FillUpRow[]> {
    const orderBy =
      groupBy === ExportGroupBy.VEHICLE
        ? [{ vehicle: { registration: 'asc' as const } }, { filled_at: 'asc' as const }]
        : groupBy === ExportGroupBy.DRIVER
        ? [{ user: { display_name: 'asc' as const } }, { filled_at: 'asc' as const }]
        : [{ filled_at: 'asc' as const }];

    const rows = await this.prisma.fillUp.findMany({
      where: {
        fleet_id: fleetId,
        filled_at: { gte: start, lte: end },
      },
      include: {
        vehicle: { select: { name: true, registration: true } },
        user: { select: { display_name: true } },
        station: { select: { name: true } },
      },
      orderBy,
    });

    return rows.map((r) => ({
      filledAt: r.filled_at,
      vehicleName: r.vehicle?.name ?? null,
      vehicleRegistration: r.vehicle?.registration ?? null,
      driverName: r.user?.display_name ?? null,
      stationName: r.station?.name ?? null,
      fuelType: r.fuel_type,
      litres: parseFloat(r.litres.toString()),
      pricePerLitrePln: parseFloat(r.price_per_litre_pln.toString()),
      totalCostPln: parseFloat(r.total_cost_pln.toString()),
      areaAvgAtFillup: r.area_avg_at_fillup ? parseFloat(r.area_avg_at_fillup.toString()) : null,
    }));
  }

  async generateExport(fleetId: string, query: ExportQueryDto): Promise<ExportResult> {
    const { start, end } = this.resolvePeriod(query.period);
    const rows = await this.fetchFillUps(fleetId, start, end, query.groupBy);

    const fleet = await this.prisma.fleet.findUnique({
      where: { id: fleetId },
      select: { name: true },
    });
    const fleetName = fleet?.name ?? 'Fleet';

    const periodLabel = `${formatDate(start)}–${formatDate(end)}`;
    const timestamp = new Date().toISOString().slice(0, 10);

    if (query.format === ExportFormat.CSV) {
      return {
        buffer: buildCsv(rows),
        filename: `expense-report-${timestamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
      };
    } else {
      return {
        buffer: await buildPdf(rows, fleetName, periodLabel, query.groupBy),
        filename: `expense-report-${timestamp}.pdf`,
        contentType: 'application/pdf',
      };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildCsv(rows: FillUpRow[]): Buffer {
  const HEADER =
    'Date,Vehicle,Registration,Driver,Station,Fuel Type,Litres,Price/L (PLN),Total (PLN),Regional Avg/L (PLN),Savings vs Avg (PLN)\n';

  const lines = rows.map((r) => {
    const savings =
      r.areaAvgAtFillup != null
        ? ((r.areaAvgAtFillup - r.pricePerLitrePln) * r.litres).toFixed(2)
        : '';
    return [
      formatDate(r.filledAt),
      csvCell(r.vehicleName ?? ''),
      csvCell(r.vehicleRegistration ?? ''),
      csvCell(r.driverName ?? ''),
      csvCell(r.stationName ?? ''),
      csvCell(r.fuelType),
      r.litres.toFixed(2),
      r.pricePerLitrePln.toFixed(2),
      r.totalCostPln.toFixed(2),
      r.areaAvgAtFillup != null ? r.areaAvgAtFillup.toFixed(2) : '',
      savings,
    ].join(',');
  });

  return Buffer.from(HEADER + lines.join('\n'), 'utf-8');
}

function csvCell(value: string): string {
  // Wrap in quotes if the value contains comma, quote, or newline
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Builder
// ─────────────────────────────────────────────────────────────────────────────

async function buildPdf(
  rows: FillUpRow[],
  fleetName: string,
  periodLabel: string,
  groupBy: ExportGroupBy,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.registerFont('Roboto', path.join(__dirname, '../assets/Roboto-Regular.ttf'));
    doc.registerFont('Roboto-Bold', path.join(__dirname, '../assets/Roboto-Bold.ttf'));
    doc.font('Roboto');

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.font('Roboto-Bold').fontSize(16).text('Expense Report', { align: 'left' });
    doc.font('Roboto').fontSize(10)
      .text(`Fleet: ${fleetName}`)
      .text(`Period: ${periodLabel}`)
      .text(`Generated: ${formatDate(new Date())}`)
      .moveDown(1);

    // Summary totals
    const totalSpend = rows.reduce((s, r) => s + r.totalCostPln, 0);
    const totalLitres = rows.reduce((s, r) => s + r.litres, 0);
    const avgPrice = totalLitres > 0 ? totalSpend / totalLitres : 0;
    const totalSavings = rows.reduce((s, r) => {
      if (r.areaAvgAtFillup == null) return s;
      return s + (r.areaAvgAtFillup - r.pricePerLitrePln) * r.litres;
    }, 0);

    doc.font('Roboto-Bold').fontSize(11).text('Summary', { underline: true });
    doc.font('Roboto').fontSize(10)
      .text(`Total spend:   ${totalSpend.toFixed(2)} PLN`)
      .text(`Total litres:  ${totalLitres.toFixed(2)} L`)
      .text(`Avg price/L:   ${avgPrice.toFixed(2)} PLN`)
      .text(`Total savings: ${totalSavings > 0 ? totalSavings.toFixed(2) + ' PLN' : 'N/A'}`)
      .moveDown(1);

    // Detail table
    doc.font('Roboto-Bold').fontSize(11).text('Fill-up Detail', { underline: true });
    doc.moveDown(0.5);

    // Column widths (A4 page width ~515pt with 40pt margins)
    const COL = { date: 60, vehicle: 80, driver: 80, station: 80, litres: 45, total: 60, savings: 60 };
    const y0 = doc.y;

    // Table header
    doc.font('Roboto-Bold').fontSize(8);
    let x = 40;
    doc.text('Date', x, y0, { width: COL.date }); x += COL.date;
    doc.text('Vehicle', x, y0, { width: COL.vehicle }); x += COL.vehicle;
    doc.text('Driver', x, y0, { width: COL.driver }); x += COL.driver;
    doc.text('Station', x, y0, { width: COL.station }); x += COL.station;
    doc.text('Litres', x, y0, { width: COL.litres }); x += COL.litres;
    doc.text('Total (PLN)', x, y0, { width: COL.total }); x += COL.total;
    doc.text('Savings (PLN)', x, y0, { width: COL.savings });

    doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).stroke();
    doc.moveDown(0.3);
    doc.font('Roboto').fontSize(8);

    // Rows — with optional group subtotals
    let currentGroupKey: string | null = null;
    let groupSpend = 0;
    let groupLitres = 0;

    const flushGroupSubtotal = (label: string) => {
      if (groupBy === ExportGroupBy.NONE) return;
      doc.font('Roboto-Bold').fontSize(8);
      const sy = doc.y;
      doc.moveTo(40, sy).lineTo(555, sy).stroke();
      doc.text(`  Subtotal — ${label}`, 40, sy + 2, { width: 265 });
      doc.text(groupLitres.toFixed(2), 40 + COL.date + COL.vehicle + COL.driver + COL.station, sy + 2, { width: COL.litres });
      doc.text(groupSpend.toFixed(2), 40 + COL.date + COL.vehicle + COL.driver + COL.station + COL.litres, sy + 2, { width: COL.total });
      doc.moveDown(0.5);
      doc.font('Roboto').fontSize(8);
      groupSpend = 0;
      groupLitres = 0;
    };

    for (const r of rows) {
      const groupKey =
        groupBy === ExportGroupBy.VEHICLE
          ? (r.vehicleRegistration ?? 'Unassigned')
          : groupBy === ExportGroupBy.DRIVER
          ? (r.driverName ?? 'Unknown')
          : null;

      if (groupKey !== null && groupKey !== currentGroupKey) {
        if (currentGroupKey !== null) flushGroupSubtotal(currentGroupKey);
        doc.font('Roboto-Bold').fontSize(9).text(groupKey, { indent: 4 });
        doc.font('Roboto').fontSize(8);
        currentGroupKey = groupKey;
      }

      const savings =
        r.areaAvgAtFillup != null
          ? ((r.areaAvgAtFillup - r.pricePerLitrePln) * r.litres).toFixed(2)
          : '—';

      const ry = doc.y;
      x = 40;
      doc.text(formatDate(r.filledAt), x, ry, { width: COL.date }); x += COL.date;
      doc.text(r.vehicleRegistration ?? '—', x, ry, { width: COL.vehicle }); x += COL.vehicle;
      doc.text(r.driverName ?? '—', x, ry, { width: COL.driver }); x += COL.driver;
      doc.text(r.stationName ?? '—', x, ry, { width: COL.station }); x += COL.station;
      doc.text(r.litres.toFixed(2), x, ry, { width: COL.litres }); x += COL.litres;
      doc.text(r.totalCostPln.toFixed(2), x, ry, { width: COL.total }); x += COL.total;
      doc.text(savings, x, ry, { width: COL.savings });
      doc.moveDown(0.3);

      groupSpend += r.totalCostPln;
      groupLitres += r.litres;
    }

    if (currentGroupKey !== null) flushGroupSubtotal(currentGroupKey);

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);  // YYYY-MM-DD, locale-neutral for reports
}
```

**Register in FleetModule:**

```typescript
// apps/api/src/fleet/fleet.module.ts
providers: [FleetService, FleetReportsService, ...],
```

**pdfkit type declaration** — add if not already present (from Story 8.4):

```typescript
// apps/api/src/types/pdfkit.d.ts  (or apps/api/src/@types/pdfkit.d.ts)
declare module 'pdfkit';
```

**Roboto-Bold.ttf** — add `apps/api/src/assets/Roboto-Bold.ttf` alongside `Roboto-Regular.ttf` (same Google Fonts source, OFL license).

---

## Fleet App Changes

### Route Handler — Export Proxy

**File:** `apps/fleet/app/api/export/route.ts` (new)

```typescript
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env['FLEET_API_URL'] ?? 'http://localhost:3001';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = (await cookies()).get('fleet_token')?.value;
  if (!token) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Forward query params (format, groupBy, period) to backend
  const { searchParams } = req.nextUrl;
  const backendUrl = `${API_BASE}/v1/fleet/reports/export?${searchParams.toString()}`;

  const upstream = await fetch(backendUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!upstream.ok) {
    return new NextResponse('Export failed', { status: upstream.status });
  }

  // Stream the file response to the browser
  const contentType = upstream.headers.get('Content-Type') ?? 'application/octet-stream';
  const contentDisposition = upstream.headers.get('Content-Disposition') ?? 'attachment';

  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
    },
  });
}
```

---

### Reports Page

**File:** `apps/fleet/app/(fleet)/reports/page.tsx` (new)

```tsx
import ReportForm from './ReportForm';

export const metadata = { title: 'Expense Reports' };

export default function ReportsPage() {
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-6">Expense Reports</h1>
      <ReportForm />
    </div>
  );
}
```

**File:** `apps/fleet/app/(fleet)/reports/ReportForm.tsx` (new)

```tsx
'use client';

import { useState } from 'react';

const PERIODS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
];

const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'No grouping' },
  { value: 'vehicle', label: 'Group by vehicle' },
  { value: 'driver', label: 'Group by driver' },
];

export default function ReportForm() {
  const [period, setPeriod] = useState('30d');
  const [groupBy, setGroupBy] = useState('none');

  function buildHref(format: 'csv' | 'pdf') {
    const params = new URLSearchParams({ format, period, groupBy });
    return `/api/export?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      {/* Period */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Period</label>
        <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                period === p.value
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Group by */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Grouping</label>
        <div className="flex flex-wrap gap-2">
          {GROUP_BY_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setGroupBy(g.value)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                groupBy === g.value
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex gap-3 pt-2">
        <a
          href={buildHref('csv')}
          download
          className="flex-1 text-center py-3 rounded-lg border border-gray-900 text-gray-900 font-medium text-sm"
        >
          Export CSV
        </a>
        <a
          href={buildHref('pdf')}
          download
          className="flex-1 text-center py-3 rounded-lg bg-gray-900 text-white font-medium text-sm"
        >
          Export PDF
        </a>
      </div>
    </div>
  );
}
```

### Navigation — Add Reports Tab

**File:** `apps/fleet/app/(fleet)/layout.tsx`

Add Reports link to the bottom tab bar (mobile) and sidebar (desktop) following the same pattern as Dashboard, Vehicles, and Drivers tabs established in Story 9.1:

```tsx
// Add to the navItems array in (fleet)/layout.tsx:
{ href: '/reports', label: 'Reports', icon: DocumentArrowDownIcon },
```

---

## No Migration Required

Story 9.3 already added `FillUp.fleet_id` via migration `add_fillup_fleet_attribution`. Story 9.4 has no new schema changes — it queries existing tables only.

---

## Tasks / Subtasks

- [ ] API: `ExportQueryDto` with `format`, `groupBy`, `period` enums (AC: 1, 2, 4)

- [ ] API: `FleetReportsService.generateExport()` (AC: 1, 2, 3, 4, 5)
  - [ ] `resolvePeriod()` — all 5 period variants incl. `lastmonth`
  - [ ] `fetchFillUps()` — Prisma query with vehicle/user/station joins + dynamic orderBy
  - [ ] `buildCsv()` — header row + one row per fill-up; CSV cell escaping; blank savings cell when no avg
  - [ ] `buildPdf()` — summary box, table header, rows, group subtotals when groupBy != 'none'
  - [ ] Add `Roboto-Bold.ttf` to `apps/api/src/assets/`

- [ ] API: `GET /v1/fleet/reports/export` endpoint in `FleetController` (AC: 1, 2, 5)
  - [ ] `@Roles(Role.FLEET_MANAGER)`, `@Res()` with buffer write
  - [ ] Register `FleetReportsService` in `FleetModule`

- [ ] Fleet app: `apps/fleet/app/api/export/route.ts` — cookie proxy route handler (AC: 5)
  - [ ] Read `fleet_token`, return 401 if absent
  - [ ] Forward query params to backend, stream response to browser

- [ ] Fleet app: `apps/fleet/app/(fleet)/reports/page.tsx` + `ReportForm.tsx` (AC: 1, 2, 3)
  - [ ] Period selector (5 options)
  - [ ] Group-by selector (3 options)
  - [ ] "Export CSV" and "Export PDF" anchor tags pointing to `/api/export?...`

- [ ] Fleet app: add Reports link to `(fleet)/layout.tsx` nav

---

## Dev Notes

### PDF Layout Limitations — pdfkit Manual Positioning

pdfkit does not have a table abstraction. The column layout in `buildPdf()` uses manual `x` coordinate positioning (`doc.text(value, x, y, { width: colWidth })`). The column widths in `COL` must sum to ≤ 515pt (A4 with 40pt margins on each side). Current total: 60 + 80 + 80 + 80 + 45 + 60 + 60 = 465pt — within budget.

For very long vehicle names or station names, pdfkit will wrap text within the column width. Row heights become variable — the `doc.y` cursor moves down automatically after the tallest cell in a row when using explicit y-positioning. Test with real data (long Polish station names like "BP Stacja Paliw Warszawa Centrum Handlowe").

### Page Overflow

pdfkit auto-adds new pages when content reaches the bottom margin. Group subtotal rows may be split across pages when a group has many fill-ups. This is acceptable for MVP — add explicit page-break logic post-MVP if needed.

### CSV Savings Sign Convention

Savings = `(areaAvgAtFillup - pricePerLitrePln) * litres`. A positive value means the driver paid less than the regional average (good). A negative value means they paid more (bad). Both are surfaced as-is in the CSV — the accountant can filter/highlight as needed. Do not suppress negatives.

### `lastmonth` Period Edge Case

For January: `month - 1 = 0` (December of previous year). JavaScript `new Date(year, -1, 1)` resolves correctly to December 1st of the prior year via Date's month overflow handling. No special case needed.

### Empty Period Export

When `rows.length === 0`:
- CSV: returns only the header row — a valid, parseable CSV.
- PDF: the summary block shows all zeros; the table renders header row only with no data rows. This is preferable to an error — the manager can confirm the period was genuinely empty.

### Roboto-Bold.ttf

If `Roboto-Bold.ttf` is unavailable (e.g. was not added to the assets directory), fall back to calling `doc.font('Roboto')` everywhere. The report will render correctly — just without bold headers. Add a `try/catch` around `doc.registerFont('Roboto-Bold', ...)` if needed.

### `download` Attribute on Anchor Tags

The `<a download>` attribute hints to the browser that the link target should be saved rather than navigated to. This works reliably when the `Content-Disposition: attachment` header is also set (both are set here). The `download` attribute alone is sufficient on same-origin links; combined with the header it works cross-browser without relying on attribute support.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
