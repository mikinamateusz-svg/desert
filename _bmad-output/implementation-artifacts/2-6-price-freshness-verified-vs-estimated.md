# Story 2.6: Price Freshness & Verified vs Estimated Display

Status: done

## Story

As a **driver**,
I want to know how fresh a price is and whether it's community-verified or just an estimate,
So that I can judge how much to trust what I'm seeing before I drive to a station.

## Why

Stale or estimated prices are worse than no prices — a driver who trusts a 3-week-old price and
finds it's wrong loses trust in the product immediately. Clearly distinguishing community-verified
prices from seeded estimates, and surfacing freshness at a glance, sets the right expectations and
drives contribution ("this price is 2 weeks old — I could fix that").

## Scope

- **In:** `PriceSource` enum + `source` field on `Submission` (schema + migration), API response
  extended with `source`, `freshnessBand` utility, `FreshnessIndicator` component (dot per price
  row), stale warning label, estimated visual treatment, `freshness.*` i18n keys.
- **Out:** staleness auto-detection flags (Story 2.8), rack-derived price ranges (Story 2.12),
  `pump_meter` source type (Epic 3), per-fuel-type independent `last_verified_at` (requires Epic 3
  submission targeting), `market_signal` table (Story 2.7), map pin freshness indicator.
- All fuel types at a station currently share one `updatedAt` (latest verified submission). True
  per-fuel-type freshness requires Epic 3 — Story 2.6 applies the freshness band uniformly to all
  fuel type rows at a station.

## Data Available

```ts
// Backend — Submission (updated schema)
Submission {
  // ... existing fields
  source: PriceSource   // NEW: community | seeded (default: community)
}

// API response (updated)
StationPriceDto {
  stationId: string
  prices: Partial<Record<FuelType, number>>
  updatedAt: string      // ISO 8601 — shared across all fuel types at this station
  source: 'community' | 'seeded'  // NEW
}
```

Freshness band thresholds (derived from `updatedAt`):
- **fresh** `< 2 days` → `tokens.fresh.recent` (#22c55e green)
- **recent** `2–7 days` → `tokens.fresh.stale` (#f59e0b amber)
- **stale** `> 7 days` → `tokens.fresh.old` (#94a3b8 slate)
- **unknown** `unparseable` → `tokens.neutral.n300` (grey, no warning shown)

## Acceptance Criteria

1. **Given** a community-verified price's `updatedAt` < 2 days ago
   **When** shown in station detail sheet
   **Then** each price row has a green dot (`tokens.fresh.recent`).

2. **Given** `updatedAt` is 2–7 days ago
   **When** shown in station detail sheet
   **Then** each price row has an amber dot (`tokens.fresh.stale`).

3. **Given** `updatedAt` > 7 days ago
   **When** shown in station detail sheet
   **Then** each price row has a slate dot (`tokens.fresh.old`) and a single
   `t('freshness.mayBeOutdated')` warning label appears below the price list.

4. **Given** `source === 'seeded'`
   **When** shown in station detail sheet
   **Then** each price row shows a hollow ring indicator (grey, no fill), the price value is
   prefixed with `~`, and a single `t('freshness.estimated')` label appears below the price list.

5. **Given** freshness indicators are shown
   **When** the user's language is EN, PL, or UK
   **Then** all freshness labels are translated via `freshness.*` i18n keys.

6. **Given** a freshness dot is rendered
   **When** read by a screen reader
   **Then** its `accessibilityLabel` includes the full `updatedAt` ISO timestamp.

7. **Given** `tsc --noEmit`
   **When** run
   **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — Backend: `source` on Submission

- [x] **1.1** Add `PriceSource` enum and `source` field to
  `packages/db/prisma/schema.prisma`:
  ```prisma
  enum PriceSource {
    community
    seeded
  }

  model Submission {
    // after ocr_confidence_score line — add:
    source  PriceSource  @default(community)
  }
  ```

- [x] **1.2** Create and apply migration (requires live DB connection):
  ```bash
  cd packages/db && npx prisma migrate dev --name add_submission_source
  ```
  Then regenerate client:
  ```bash
  npx prisma generate
  ```

- [x] **1.3** Update `apps/api/src/price/price.service.ts` — add `source` to
  `StationPriceRow` interface and to the SQL SELECT:
  ```ts
  interface StationPriceRow {
    stationId: string;
    prices: Record<string, number>;
    updatedAt: Date;
    source: 'community' | 'seeded';
  }

  // SQL: add   sub.source AS source   to the SELECT list
  SELECT DISTINCT ON (sub.station_id)
    sub.station_id   AS "stationId",
    sub.price_data   AS prices,
    sub.created_at   AS "updatedAt",
    sub.source       AS source
  FROM "Submission" sub
  ...
  ```

- [x] **1.4** Update `apps/api/src/price/dto/station-price.dto.ts`:
  ```ts
  export class StationPriceDto {
    stationId!: string;
    prices!: Record<string, number>;
    updatedAt!: string;
    source!: 'community' | 'seeded';
  }
  ```

- [x] **1.5** Update controller mapping in
  `apps/api/src/price/price.controller.ts` to include `source`:
  ```ts
  return rows.map(r => ({
    stationId: r.stationId,
    prices: r.prices,
    updatedAt: new Date(r.updatedAt).toISOString(),
    source: r.source,
  }));
  ```

- [x] **1.6** Update `apps/api/src/price/price.service.spec.ts` — add
  `source: 'community'` to all `fakeRows` entries; update the field-presence
  assertion:
  ```ts
  expect(result[0]).toMatchObject({
    stationId: 'station-1',
    prices: { PB_95: 6.42, ON: 6.89 },
    updatedAt: now,
    source: 'community',
  });
  ```

- [x] **1.7** Update `apps/api/src/price/price.controller.spec.ts` — add
  `source: 'community'` to `fakePriceRows`; add assertion:
  ```ts
  expect(result[0]).toMatchObject({ stationId: 'station-1', source: 'community' });
  ```

### Phase 2 — Mobile: `freshnessBand` utility

- [x] **2.1** Update `apps/mobile/src/api/prices.ts` — add `source` to
  `StationPriceDto`:
  ```ts
  export type StationPriceDto = {
    stationId: string;
    prices: Partial<Record<FuelType, number>>;
    updatedAt: string;
    source: 'community' | 'seeded';
  };
  ```

- [x] **2.2** Create `apps/mobile/src/utils/freshnessBand.ts`:
  ```ts
  export type FreshnessBand = 'fresh' | 'recent' | 'stale' | 'unknown';

  /**
   * Categorises elapsed time since an ISO timestamp.
   *
   * fresh:   < 2 days
   * recent:  2–7 days
   * stale:   > 7 days
   * unknown: unparseable isoString (NaN guard)
   */
  export function freshnessBand(isoString: string): FreshnessBand {
    const ts = new Date(isoString).getTime();
    if (isNaN(ts)) return 'unknown';
    const diffMs = Date.now() - ts;
    if (diffMs < 0) return 'fresh'; // future timestamp (clock skew)
    const days = diffMs / 86_400_000;
    if (days < 2) return 'fresh';
    if (days < 7) return 'recent';
    return 'stale';
  }
  ```

### Phase 3 — Mobile: `FreshnessIndicator` component

- [x] **3.1** Create `apps/mobile/src/components/FreshnessIndicator.tsx`:

  Props:
  ```ts
  interface Props {
    band: FreshnessBand;
    source: 'community' | 'seeded';
    updatedAt: string; // used for accessibilityLabel only
  }
  ```

  Rendering rules:
  - `source === 'seeded'`: hollow ring (8×8, `borderWidth: 1.5`, `borderColor:
    tokens.neutral.n400`, `backgroundColor: 'transparent'`, borderRadius: 4),
    `accessibilityLabel={`Estimated price. Last known: ${updatedAt}`}`
  - `source === 'community'`:
    - `fresh`  → filled dot, `backgroundColor: tokens.fresh.recent`
    - `recent` → filled dot, `backgroundColor: tokens.fresh.stale`
    - `stale`  → filled dot, `backgroundColor: tokens.fresh.old`
    - `unknown`→ filled dot, `backgroundColor: tokens.neutral.n300`
    - All community dots: `accessibilityLabel={`Price updated: ${updatedAt}`}`

  Dot size: 8×8, `borderRadius: 4`.

### Phase 4 — Mobile: Update `StationDetailSheet`

- [x] **4.1** In `apps/mobile/src/components/StationDetailSheet.tsx`:
  - Import `FreshnessIndicator` and `freshnessBand`, `FreshnessBand`.
  - Remove import of `relativeTime` (no longer needed).
  - Remove the `freshness` computed variable and `stationDetail.justNow` /
    `stationDetail.updatedAgo` usage.
  - Derive band once (shared across all rows):
    ```ts
    const band: FreshnessBand = prices ? freshnessBand(prices.updatedAt) : 'unknown';
    ```
  - Update each price row to include the indicator on the right, before the price
    value:
    ```tsx
    <View key={ft} style={styles.priceRow}
      accessibilityLabel={`${t(`fuelTypes.${ft}`)}: ${
        prices!.source === 'seeded' ? '~' : ''
      }${price.toFixed(2)} zł/l`}
    >
      <Text style={styles.priceLabel}>{t(`fuelTypes.${ft}`)}</Text>
      <View style={styles.priceRight}>
        <FreshnessIndicator
          band={band}
          source={prices!.source}
          updatedAt={prices!.updatedAt}
        />
        <Text style={[
          styles.priceValue,
          prices!.source === 'seeded' && styles.priceValueEstimated,
        ]}>
          {prices!.source === 'seeded' ? `~${price.toFixed(2)}` : price.toFixed(2)} zł/l
        </Text>
      </View>
    </View>
    ```
  - Replace the old `{freshness !== null && <Text ...>}` block with:
    ```tsx
    {band === 'stale' && prices!.source === 'community' && (
      <Text style={styles.staleWarning}>{t('freshness.mayBeOutdated')}</Text>
    )}
    {prices!.source === 'seeded' && (
      <Text style={styles.estimatedLabel}>{t('freshness.estimated')}</Text>
    )}
    ```
  - Add new styles:
    ```ts
    priceRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    priceValueEstimated: {
      color: tokens.neutral.n400,
    },
    staleWarning: {
      fontSize: 12,
      color: tokens.fresh.old,
      marginTop: 6,
      textAlign: 'right',
    },
    estimatedLabel: {
      fontSize: 12,
      color: tokens.neutral.n400,
      marginTop: 6,
      textAlign: 'right',
    },
    ```

- [x] **4.2** Delete `apps/mobile/src/utils/relativeTime.ts` (no longer used
  after removing `freshness` from `StationDetailSheet`).

### Phase 5 — i18n

- [x] **5.1** Add `freshness` namespace to
  `apps/mobile/src/i18n/locales/en.ts`, `pl.ts`, `uk.ts`:

  EN:
  ```ts
  freshness: {
    fresh:         'Just updated',
    recent:        'Updated recently',
    mayBeOutdated: 'Price may be outdated',
    estimated:     'Estimated',
  },
  ```
  PL:
  ```ts
  freshness: {
    fresh:         'Właśnie zaktualizowano',
    recent:        'Zaktualizowano niedawno',
    mayBeOutdated: 'Cena może być nieaktualna',
    estimated:     'Szacowana',
  },
  ```
  UK:
  ```ts
  freshness: {
    fresh:         'Щойно оновлено',
    recent:        'Нещодавно оновлено',
    mayBeOutdated: 'Ціна може бути застарілою',
    estimated:     'Орієнтовна',
  },
  ```

### Phase 6 — Final checks

- [x] **6.1** Run `pnpm test` from repo root — all tests pass (API suite
  including updated service + controller specs).
- [x] **6.2** Run `tsc --noEmit` (from `apps/mobile`) — zero errors.

## Definition of Done

- `PriceSource` enum + `source @default(community)` on `Submission` in schema
- Migration applied, Prisma client regenerated
- API returns `source: 'community' | 'seeded'` in `/v1/prices/nearby` response
- `freshnessBand` utility in `apps/mobile/src/utils/freshnessBand.ts`
- `FreshnessIndicator` component renders correct dot / hollow ring per band + source
- `StationDetailSheet` shows dot per row, stale warning, estimated label, `~` prefix
- `relativeTime.ts` deleted (dead code)
- `freshness.*` i18n keys in EN / PL / UK
- All backend tests passing (no regressions); `tsc --noEmit` clean

## Deferred

- **Per-fuel-type independent freshness** — requires Epic 3 per-fuel-type submission targeting
- **Staleness auto-detection display** (`price may have changed` flag from Story 2.8) — Story 2.8
  will set the flags; UI hook can be added then
- **Rack-derived estimated price range** (Story 2.12) — seeded prices currently show single value
  with `~` prefix; range format (`~6.40–6.70`) requires Story 2.7 + 2.12
- **`pump_meter` source type** — added with Epic 3 fill-up submission flow
- **Map pin freshness indicator** — separate story; detail sheet is the primary freshness surface

## Review Notes (2026-04-04)

No new patches. Prior review applied all patches — see sprint-status.yaml for details.
