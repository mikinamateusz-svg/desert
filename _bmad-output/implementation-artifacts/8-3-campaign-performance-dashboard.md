# Story 8.3: Campaign Performance Dashboard

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.3
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 8.1 (`PromotionCampaign` model, `PromotionService.checkPriceGate()`), Story 8.2 (promoted display — campaign must be visible before metrics accumulate), Story 7.4 (`StationViewEvent` table, event logging infrastructure)
- **Required by:** Story 8.4 (billing portal links back to campaign history)

---

## User Story

**As a verified station owner,**
I want to see how my promotional campaign is performing and manage it,
So that I can evaluate whether the boost is delivering value and decide whether to buy again.

---

## Context & Why

Without visibility into what a promotion actually does, renewal is a leap of faith. Impressions and CTR close the loop — owners who see their station getting more detail opens during active days will renew. The dashboard also makes the auto-pause mechanic transparent: owners see exactly which days were active vs. paused and why, so the model feels fair rather than opaque.

### Metric Definitions

| Metric | Source | Notes |
|--------|--------|-------|
| Impressions | `StationViewEvent` WHERE `event_type = 'map_view'` AND `created_at >= purchased_at` | Counts events from Story 7.4 (mobile batch) — includes paused days (MVP approximation; post-MVP, exclude events during pause windows) |
| Detail opens | `StationViewEvent` WHERE `event_type = 'detail_open'` AND `created_at >= purchased_at` | Precise: one event per `handlePinPress` |
| CTR | `detail_opens / impressions` | 0 if impressions = 0; rounded to 1 decimal place as percentage |
| Active days consumed | `PromotionCampaign.active_days_consumed` | Incremented by daily job |
| Paused days | `FLOOR((now - purchased_at) / 86400) - active_days_consumed` | Approximate; days in neither active nor consumed bucket = paused |

---

## Acceptance Criteria

**Given** a verified station owner opens the Promotions section and views an active campaign
**When** they see the campaign card
**Then** they see: current status badge (Active / Paused — with reason), active days remaining (`active_days_purchased - active_days_consumed`), days until 90-day hard expiry, and all 5 metrics updated daily

**Given** a campaign is in PAUSED status
**When** the owner views the dashboard
**Then** a prominent banner is shown: "Your promotion is paused — your prices are above the area median. Update your prices to resume automatically."
**And** the current price vs. area median is shown for the relevant fuel type (e.g. "PB95: 6.89 PLN/L vs median 6.72 PLN/L")

**Given** a campaign auto-resumes (price drops ≤ median)
**When** the owner views the dashboard
**Then** the status shows "Active" and the pause banner is gone — no manual action required

**Given** an owner wants to cancel an active or paused campaign
**When** they tap "Cancel Campaign"
**Then** they are shown a confirmation: "You are about to cancel this promotion. [N] unused active days will be forfeited — no refund will be issued. Are you sure?"
**And** on confirmation the campaign status is set to CANCELLED, promoted treatment is removed immediately
**And** on cancel (abort) the campaign continues unchanged

**Given** a campaign has status CANCELLED, EXPIRED, or has consumed all active days
**When** the owner views their Promotions section
**Then** the completed/expired campaign appears in a "Past campaigns" section with all metrics frozen at final values
**And** each past campaign shows its end reason: "All active days used" / "90-day window expired" / "Cancelled"

**Given** the dashboard is viewed in Polish, English, or Ukrainian
**When** it renders
**Then** all labels, dates, and number formats are displayed in the correct language
**And** dates use localised format (e.g. "7 kwi 2026" in Polish)

---

## API Changes

### New Endpoint: GET /v1/partner/promotions/:campaignId/metrics

**Controller:** `PromotionController`

```typescript
// GET /v1/partner/promotions/:campaignId/metrics
// Auth: @Roles(STATION_MANAGER)
// Ownership check: campaign.user_id === authenticated user id

// Response shape:
interface CampaignMetricsDto {
  campaign: {
    id: string;
    status: CampaignStatus;
    activeDaysPurchased: number;
    activeDaysConsumed: number;
    activeDaysRemaining: number;     // activeDaysPurchased - activeDaysConsumed
    purchasedAt: string;             // ISO datetime
    expiresAt: string;               // ISO datetime
    daysUntilExpiry: number;         // Math.ceil((expiresAt - now) / 86400000)
    endReason?: 'days_consumed' | 'expiry' | 'cancelled';  // null if not ended
  };
  metrics: {
    impressions: number;
    detailOpens: number;
    ctr: number;                     // percentage, 1 decimal place (e.g. 14.3)
    pausedDays: number;
  };
  pauseInfo?: {                      // present when status === PAUSED
    currentPrice: number;
    medianPrice: number;
    fuelType: string;
  };
}
```

**Service implementation:**

```typescript
// apps/api/src/promotion/promotion.service.ts

async getCampaignMetrics(userId: string, campaignId: string): Promise<CampaignMetricsDto> {
  const campaign = await this.prisma.promotionCampaign.findUniqueOrThrow({
    where: { id: campaignId },
  });

  // Ownership check
  if (campaign.user_id !== userId) throw new ForbiddenException();

  // Fetch impression/detail_open counts from StationViewEvent since purchased_at
  const [impressions, detailOpens] = await Promise.all([
    this.prisma.stationViewEvent.count({
      where: {
        station_id: campaign.station_id,
        event_type: 'map_view',
        created_at: { gte: campaign.purchased_at ?? new Date(0) },
      },
    }),
    this.prisma.stationViewEvent.count({
      where: {
        station_id: campaign.station_id,
        event_type: 'detail_open',
        created_at: { gte: campaign.purchased_at ?? new Date(0) },
      },
    }),
  ]);

  const ctr = impressions > 0
    ? Math.round((detailOpens / impressions) * 1000) / 10  // e.g. 14.3
    : 0;

  const now = new Date();
  const calendarDaysSincePurchase = campaign.purchased_at
    ? Math.floor((now.getTime() - campaign.purchased_at.getTime()) / 86_400_000)
    : 0;
  const pausedDays = Math.max(0, calendarDaysSincePurchase - campaign.active_days_consumed);

  // Pause info (only for PAUSED campaigns)
  let pauseInfo: CampaignMetricsDto['pauseInfo'];
  if (campaign.status === CampaignStatus.PAUSED) {
    const gate = await this.checkPriceGate(campaign.station_id);
    pauseInfo = {
      currentPrice: gate.currentPrice ?? 0,
      medianPrice: gate.medianPrice ?? 0,
      fuelType: gate.fuelType ?? 'pb95',
    };
  }

  const endReason = campaign.status === CampaignStatus.CANCELLED
    ? 'cancelled'
    : campaign.status === CampaignStatus.EXPIRED
      ? (campaign.active_days_consumed >= campaign.active_days_purchased ? 'days_consumed' : 'expiry')
      : undefined;

  return {
    campaign: {
      id: campaign.id,
      status: campaign.status,
      activeDaysPurchased: campaign.active_days_purchased,
      activeDaysConsumed: campaign.active_days_consumed,
      activeDaysRemaining: Math.max(0, campaign.active_days_purchased - campaign.active_days_consumed),
      purchasedAt: campaign.purchased_at?.toISOString() ?? '',
      expiresAt: campaign.expires_at?.toISOString() ?? '',
      daysUntilExpiry: campaign.expires_at
        ? Math.max(0, Math.ceil((campaign.expires_at.getTime() - now.getTime()) / 86_400_000))
        : 0,
      endReason,
    },
    metrics: { impressions, detailOpens, ctr, pausedDays },
    pauseInfo,
  };
}
```

### Updated: GET /v1/partner/promotions/:stationId

Return all campaigns (all statuses) for the station, ordered by `created_at DESC`. The existing endpoint from Story 8.1 should return both active and past campaigns so the partner app can split them into "active" and "past" sections.

```typescript
// Return shape: PromotionCampaign[] (all statuses, ordered by created_at DESC)
// Include: id, status, active_days_purchased, active_days_consumed, purchased_at, expires_at, price_pln, payment_method
// Do NOT include full metrics here — metrics fetched separately per campaign via /metrics
```

---

## Partner App — Promotions Dashboard

### Page Structure

**`apps/partner/src/app/promotions/page.tsx`** — Main Promotions page (Server Component)

Fetches campaign list from `GET /v1/partner/promotions/:stationId` via `partnerFetch`.

Splits campaigns into:
- `active`: status in `[ACTIVE, PAUSED, PENDING_PAYMENT]` — shown at top
- `past`: status in `[EXPIRED, CANCELLED]` — shown in collapsible "Past campaigns" section

### Active Campaign Card

**`apps/partner/src/app/promotions/CampaignCard.tsx`** — Client Component

Fetches metrics from `GET /v1/partner/promotions/:campaignId/metrics` on mount via a server action, then re-fetches when status might have changed (on page focus).

```tsx
// Layout (top to bottom):
// 1. Status badge row: [Active | Paused] pill + "X active days remaining" + "Expires in N days"
// 2. Pause banner (if PAUSED): amber box with text + currentPrice vs medianPrice
// 3. Metrics grid (2×2):
//    [ Impressions: N ]  [ Detail Opens: N ]
//    [ CTR: N% ]         [ Active Days: N/N ]
// 4. Paused days note (if pausedDays > 0): "N day(s) paused due to price gate"
// 5. Cancel button (only for ACTIVE or PAUSED status): red ghost button
```

### Metrics Fetch Server Action

```typescript
// apps/partner/src/app/promotions/fetch-metrics-action.ts
'use server';

import { partnerFetch } from '@/lib/partner-api';

export async function fetchCampaignMetrics(campaignId: string) {
  return partnerFetch<CampaignMetricsDto>('GET', `/v1/partner/promotions/${campaignId}/metrics`);
}
```

### Cancel Campaign Flow

**`apps/partner/src/app/promotions/cancel-action.ts`** — Server Action

```typescript
'use server';
import { partnerFetch } from '@/lib/partner-api';

export async function cancelCampaignAction(campaignId: string) {
  return partnerFetch('POST', `/v1/partner/promotions/${campaignId}/cancel`);
}
```

**In `CampaignCard.tsx`** — Client Component handles confirmation:

```tsx
const [confirming, setConfirming] = useState(false);

// When confirming === false: show "Cancel Campaign" button
// When confirming === true: show confirmation block:
//   "You are about to cancel this promotion. [N] unused active days will be forfeited — no refund."
//   [Confirm Cancel] [Keep Campaign] buttons
// On confirm: call cancelCampaignAction(campaign.id), refresh page
```

### Past Campaign Card

**`apps/partner/src/app/promotions/PastCampaignCard.tsx`** — Server Component (no live fetch needed)

Displays frozen campaign data + final metrics. Uses `fetchCampaignMetrics` server action called at render time (Server Component can await).

```tsx
// Layout:
// 1. Header: "Active days used: N/N" | end reason label
// 2. Dates: "Purchased: [date]" → "Ended: [date or expiry date]"
// 3. Same metrics grid (read-only, no cancel button)
// 4. End reason pill: "All days used" / "Expired" / "Cancelled"
```

### Pause Banner Component

```tsx
// apps/partner/src/app/promotions/PauseBanner.tsx
// Amber banner showing:
// "Your promotion is paused — your [fuelType] prices are above the area median."
// Row: "Your price: [currentPrice] PLN/L   Median: [medianPrice] PLN/L"
// CTA link: "Update your prices →" → navigates to /prices page

// i18n:
//   pl: "Twoja promocja jest wstrzymana — Twoje ceny są powyżej mediany."
//   en: "Your promotion is paused — your prices are above the area median."
//   uk: "Вашу акцію призупинено — ваші ціни перевищують медіану регіону."
```

### i18n Strings

```typescript
// apps/partner/src/i18n/pl.ts (partner app i18n — follows same pattern as apps/admin)
promotions: {
  status: {
    ACTIVE: 'Aktywna',
    PAUSED: 'Wstrzymana',
    CANCELLED: 'Anulowana',
    EXPIRED: 'Wygasła',
    PENDING_PAYMENT: 'Oczekuje na płatność',
  },
  metrics: {
    impressions: 'Wyświetlenia',
    detailOpens: 'Otwarcia szczegółów',
    ctr: 'CTR',
    activeDays: 'Aktywne dni',
    pausedDays: 'Dni wstrzymania',
  },
  activeDaysRemaining: '{{count}} aktywnych dni pozostało',
  expiresIn: 'Wygasa za {{count}} dni',
  cancelButton: 'Anuluj promocję',
  cancelConfirm: 'Utracisz {{count}} niewykorzystane dni. Zwrot nie jest możliwy.',
  cancelConfirmButton: 'Potwierdź anulowanie',
  cancelAbortButton: 'Zachowaj promocję',
  pastCampaigns: 'Poprzednie kampanie',
  endReason: {
    days_consumed: 'Wszystkie dni wykorzystane',
    expiry: 'Wygasła (90 dni)',
    cancelled: 'Anulowana',
  },
},
```

Add equivalent keys for `en.ts` and `uk.ts`.

---

## Tasks / Subtasks

- [ ] API: GET /v1/partner/promotions/:campaignId/metrics endpoint (AC: 1, 2, 3, 5)
  - [ ] `getCampaignMetrics()` in PromotionService
  - [ ] Ownership check (userId === campaign.user_id)
  - [ ] Count StationViewEvents since purchased_at (parallel queries)
  - [ ] Paused days calculation
  - [ ] pauseInfo populated from checkPriceGate() for PAUSED campaigns
  - [ ] endReason derivation

- [ ] API: Update GET /v1/partner/promotions/:stationId to return all statuses (AC: 5)
  - [ ] Return all campaigns ordered by created_at DESC
  - [ ] No status filter — let client split

- [ ] Partner app: CampaignCard component (AC: 1, 2, 3, 4)
  - [ ] Metrics grid layout
  - [ ] Status badge
  - [ ] Pause banner with price vs median
  - [ ] "Paused days" note
  - [ ] Cancel button → confirmation flow

- [ ] Partner app: PastCampaignCard component (AC: 5)
  - [ ] Frozen metrics display
  - [ ] End reason pill
  - [ ] Purchase/end dates

- [ ] Partner app: fetchCampaignMetrics server action (AC: 1)
- [ ] Partner app: cancelCampaignAction server action (AC: 4)
- [ ] Partner app: PauseBanner component with price/median row (AC: 2)
- [ ] Partner app: Promotions page splits active vs past sections (AC: 5)
- [ ] i18n strings: pl/en/uk for all promotions keys (AC: 6)

---

## Dev Notes

### Metric Approximation — Impressions During Pause

In this MVP, `StationViewEvent` counts are from `created_at >= purchased_at` regardless of pause windows. This means paused days still contribute impressions (the pin was still on the map, but NOT with promoted treatment). Post-MVP, store `PromotionCampaignPauseLog` entries with start/end timestamps to exclude pause windows from impression counts precisely.

Document this in the partner app UI with a tooltip or footnote: "Impressions and detail opens include all days since purchase. Active days only show days your promotion was running."

### CampaignCard — Client vs Server

`CampaignCard` is a Client Component because it needs: (1) the cancel confirmation state, (2) re-fetch on page focus. All data fetching is via Server Actions (not `useEffect` fetch), so the httpOnly `partner_token` cookie is accessible. Pattern established in Story 7.4 `PerformancePanel`.

### Paused Days Floor vs Ceiling

`pausedDays = Math.max(0, calendarDaysSincePurchase - active_days_consumed)`.

Edge case: on the day of purchase (calendarDaysSincePurchase = 0), `pausedDays = -active_days_consumed` → clamped to 0 by `Math.max`. This is correct — no paused days on day 0.

Edge case: if campaign was just activated today and already paused (same day), `pausedDays = 0` still correct since the job hasn't run.

### CTR Display

Round to 1 decimal: `14.3%`. If `impressions = 0`, show `–` (dash) rather than `0%` to avoid misleading CTR of zero on day 1 when impressions haven't accumulated yet. The API returns `ctr: 0` in this case — the partner app renders `–` when `metrics.impressions === 0`.

### daysUntilExpiry

Use `Math.ceil` so "less than 1 full day" still shows as "1 day" — avoids showing "0 days" when there are still hours left.

### CampaignStatus Enum in Partner App

`CampaignStatus` is a Prisma enum defined in `apps/api`. The partner app receives it as a string in the API response. Define a mirrored TypeScript union type in the partner app:

```typescript
// apps/partner/src/types/promotion.ts
export type CampaignStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'CANCELLED';
```

Do NOT import from `@prisma/client` in the partner app — the partner app does not have a direct Prisma dependency.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
