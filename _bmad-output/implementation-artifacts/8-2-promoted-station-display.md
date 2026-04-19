# Story 8.2: Promoted Station Display

## Metadata
- **Epic:** 8 — Station Promotions & Advertising
- **Story ID:** 8.2
- **Status:** ready-for-dev
- **Date:** 2026-04-07
- **Depends on:** Story 8.1 (`PromotionCampaign` model, `CampaignStatus.ACTIVE`), Story 2.5 (StationDetailSheet, StationPin, MarkerView map rendering pattern)
- **Required by:** Story 8.3 (campaign metrics use impression/detail_open counts recorded here)

---

## User Story

**As a driver,**
I want promoted stations to stand out visually on the map while remaining clearly marked as sponsored,
So that I notice active, price-competitive stations without feeling misled about organic rankings.

---

## Context & Why

The visual boost is what station owners are paying for. Clear "Sponsored" labelling — on the pin, in the list card, and in the detail sheet — ensures drivers are never surprised. The price gate from Story 8.1 guarantees that promoted stations are genuinely price-competitive, so the boost serves driver interest too.

Map rank order must never change — promoted status only affects visual treatment, not position.

### Existing Code to Understand Before Starting

The map screen (`apps/mobile/app/(app)/index.tsx`) renders stations via `@rnmapbox/maps` `MarkerView` + the custom `StationPin` component. There is currently NO station list view in the codebase. The "list view" AC is satisfied by adding a new `StationListSheet` bottom sheet (a scrollable list of nearby stations, toggled by a list button in the top bar).

`StationPin` (`apps/mobile/src/components/map/StationPin.tsx`) is a teardrop-shaped RN `View` with a price label. It has `isSelected` (PIN_SIZE_SELECTED = 38 vs PIN_SIZE = 32). For promoted stations, add `isPromoted` prop — renders a gold border ring around the pin and bumps size to PIN_SIZE_PROMOTED = 42.

`StationDetailSheet` (`apps/mobile/src/components/StationDetailSheet.tsx`) receives `StationDto | null`. Extend `StationDto` in `apps/mobile/src/api/stations.ts` with `is_promoted: boolean` and the station will automatically pass through to the sheet.

---

## Acceptance Criteria

**Given** a driver views the map
**When** one or more nearby stations have an active promotion (CampaignStatus.ACTIVE)
**Then** those station pins are visually enhanced: larger size (PIN_SIZE_PROMOTED = 42), gold/amber border ring, and a small "S★" badge overlaid in the top-right corner of the pin
**And** the enhanced treatment is consistent across map view and list view

**Given** a driver opens the station list view (toggled via the list icon in the map top bar)
**When** a promoted station appears in the list
**Then** its list card shows: station logo, current prices for all available fuel types, freshness status indicator, and a prominent "Sponsored" pill label — all visible without tapping

**Given** a driver taps a promoted station pin to open its detail sheet
**When** the `StationDetailSheet` is shown
**Then** a "Sponsored" pill badge is rendered below the station name (in the header area, above the price list)
**And** the badge text is localised: "Sponsorowane" (pl) / "Sponsored" (en) / "Реклама" (uk)

**Given** a driver views the map
**When** promoted stations are present
**Then** the map order of pins (rendered in the order returned by the API — sorted by distance) is not changed — promoted stations appear at their natural position, just with enhanced visual treatment

**Given** a promoted station's campaign is auto-paused or expires
**When** the driver next loads the map (fresh `GET /v1/stations/nearby` call)
**Then** `is_promoted` is `false` in the API response and the station reverts to standard organic pin appearance — no enhanced treatment is shown

**Given** a promoted station owner has enabled price-drop notifications (`price_drop_notify: true` on campaign)
**When** the owner updates their price via the partner portal and `PromotionService.resumeCampaignsForStation()` detects the campaign is ACTIVE
**Then** a push notification is sent to drivers who have opted in to price alerts for this station's area (using the existing Epic 6 notification infrastructure)
**And** the notification text is: "[Station name] dropped [fuel type] to [price] PLN/L" (localised)
**And** the notification is only sent if `campaign.status === ACTIVE` after the price write

**Given** the driver's language is Polish, English, or Ukrainian
**When** any sponsored label or notification is rendered
**Then** it is displayed in the driver's selected language

---

## Schema Changes

None in this story. Reads `PromotionCampaign` added in Story 8.1.

---

## API Changes

### Extend `/v1/stations/nearby` Response

**File:** `apps/api/src/station/station.service.ts` (or wherever `getNearbyStations()` is implemented)

Add `is_promoted: boolean` to the station response DTO. This requires a LEFT JOIN or separate query to check for active campaigns.

**Efficient approach — single query:**

```typescript
// In StationService.getNearbyStations():
// After fetching stations array, do a single batch check:
const stationIds = stations.map(s => s.id);
const promotedIds = await this.prisma.promotionCampaign.findMany({
  where: {
    station_id: { in: stationIds },
    status: CampaignStatus.ACTIVE,
  },
  select: { station_id: true },
});
const promotedSet = new Set(promotedIds.map(p => p.station_id));

return stations.map(s => ({
  ...s,
  is_promoted: promotedSet.has(s.id),
}));
```

**Cache consideration:** The nearby stations response is cached with a price-driven TTL. `is_promoted` changes are near real-time (Stripe webhook → ACTIVE, daily job → PAUSED/EXPIRED). Acceptable approach: include `is_promoted` in the existing Redis cache and set a shorter TTL of **5 minutes** for the stations cache when any station in the result set has an active campaign. If no promoted stations are in the result, use the existing TTL.

Simpler MVP alternative: do NOT cache the `is_promoted` field — fetch it fresh on every `/v1/stations/nearby` request (the batch query is cheap: single WHERE IN on indexed `station_id + status`). Mark this as a known performance consideration for post-MVP.

### Update StationDto in Mobile

```typescript
// apps/mobile/src/api/stations.ts
export type StationDto = {
  id: string;
  name: string;
  address: string | null;
  google_places_id: string | null;
  brand: string | null;
  lat: number;
  lng: number;
  is_promoted: boolean;  // ADD THIS
};
```

---

## Mobile Changes

### 1. StationPin — Promoted Visual Treatment

```typescript
// apps/mobile/src/components/map/StationPin.tsx

const PIN_SIZE = 32;
const PIN_SIZE_SELECTED = 38;
const PIN_SIZE_PROMOTED = 42;          // ADD

interface StationPinProps {
  priceColor: PriceColor;
  label: string;
  isEstimated: boolean;
  isSelected?: boolean;
  isPromoted?: boolean;                // ADD
  onPress: () => void;
}

// In the component:
const size = isPromoted ? PIN_SIZE_PROMOTED : (isSelected ? PIN_SIZE_SELECTED : PIN_SIZE);

// Add gold ring for promoted:
// In the inner View style, when isPromoted:
//   borderWidth: 3, borderColor: '#f59e0b' (tokens.price.mid amber)
//   Add a small badge overlay (View positioned absolute top-right)
```

The promoted badge overlay is a small `View` with a "★" character or an "S" text rendered at 10px — positioned absolutely in the top-right corner of the pin container. It uses `zIndex: 10` to appear above the teardrop rotation.

```tsx
{isPromoted && (
  <View style={styles.promotedBadge}>
    <Text style={styles.promotedBadgeText}>★</Text>
  </View>
)}

// styles:
promotedBadge: {
  position: 'absolute',
  top: -4,
  right: -4,
  width: 14,
  height: 14,
  borderRadius: 7,
  backgroundColor: '#f59e0b',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
},
promotedBadgeText: {
  fontSize: 8,
  color: '#ffffff',
  fontWeight: '800',
  includeFontPadding: false,
},
```

### 2. Map Screen — Pass isPromoted to StationPin

```typescript
// apps/mobile/app/(app)/index.tsx
// In the stations.map() render loop:
<StationPin
  priceColor={priceColor}
  label={label}
  isEstimated={isEstimated}
  isSelected={station.id === selectedStation?.id}
  isPromoted={station.is_promoted}   // ADD
  onPress={() => handlePinPress(station.id)}
/>
```

### 3. StationDetailSheet — Sponsored Badge

Add a "Sponsored" pill badge in the header section, rendered only when `station.is_promoted === true`.

```tsx
// apps/mobile/src/components/StationDetailSheet.tsx
// After the header View (brand logo + station name + address), add:

{displayStation?.is_promoted && (
  <View style={styles.sponsoredBadge}>
    <Text style={styles.sponsoredBadgeText}>{t('station.sponsored')}</Text>
  </View>
)}

// styles:
sponsoredBadge: {
  alignSelf: 'flex-start',
  marginTop: 4,
  marginBottom: 8,
  paddingHorizontal: 10,
  paddingVertical: 3,
  backgroundColor: '#fef3c7',  // amber-100
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#f59e0b',       // amber-500
},
sponsoredBadgeText: {
  fontSize: 12,
  fontWeight: '600',
  color: '#92400e',             // amber-800
},
```

### 4. New StationListSheet Component

**File:** `apps/mobile/src/components/StationListSheet.tsx`

A scrollable bottom sheet listing nearby stations, toggled from the map top bar. This satisfies the "list view" AC.

```tsx
// Props
interface StationListSheetProps {
  stations: StationDto[];
  prices: StationPriceDto[];
  selectedFuel: FuelType | null;
  onStationPress: (stationId: string) => void;
  onDismiss: () => void;
  visible: boolean;
}

// Renders a Modal (same pattern as StationDetailSheet) with:
// - Header: "Nearby stations" (localised) + close button
// - ScrollView of StationListCard items
```

**File:** `apps/mobile/src/components/StationListCard.tsx`

```tsx
// Props: station, prices, selectedFuel, onPress
// Renders for promoted stations (station.is_promoted === true):
//   - BrandLogo (larger, from existing component)
//   - Station name + address
//   - ALL available fuel prices (not just selected fuel) shown as compact price rows
//   - FreshnessIndicator for the selected fuel
//   - "Sponsored" pill (same style as StationDetailSheet badge)
// Renders for organic stations:
//   - BrandLogo (smaller)
//   - Station name + address
//   - Selected fuel price only
//   - FreshnessIndicator
// No "Sponsored" pill
```

**Toggle button in map top bar:**

```tsx
// apps/mobile/app/(app)/index.tsx
// Add list icon button to top bar (Ionicons 'list-outline')
// State: const [showStationList, setShowStationList] = useState(false);
// Renders <StationListSheet> when visible
// The list button sits in the top-right area of the map top bar
```

### 5. i18n Strings

```typescript
// apps/mobile/src/i18n/locales/pl.ts
station: {
  sponsored: 'Sponsorowane',
  // ... existing keys
},
map: {
  stationListTitle: 'Stacje w pobliżu',
  // ... existing keys
},

// apps/mobile/src/i18n/locales/en.ts
station: {
  sponsored: 'Sponsored',
},
map: {
  stationListTitle: 'Nearby stations',
},

// apps/mobile/src/i18n/locales/uk.ts
station: {
  sponsored: 'Реклама',
},
map: {
  stationListTitle: 'Найближчі станції',
},
```

---

## Price-Drop Push Notification (Optional Add-on)

The AC marks this as "Optional". This is an additive feature on top of the existing Epic 6 push notification infrastructure.

**Trigger point:** `PromotionService.resumeCampaignsForStation()` in `apps/api/src/promotion/promotion.service.ts` — after a campaign resumes AND `campaign.price_drop_notify === true`.

**Challenge:** Sending to "nearby drivers" requires knowing which drivers are currently in proximity. The mobile app does not persist driver locations server-side (per the privacy decisions in the architecture). Feasible approaches for MVP:

1. **Opt-in station follow** — drivers who have "followed" a station receive price-drop notifications for that station. Requires a `StationFollow` table (not currently in the schema).
2. **Area-based opt-in** — drivers who opted in to price alerts for a given voivodeship (from Story 6.4). These are the same drivers who receive `PRICE_DROP` alerts.

**MVP approach:** Reuse the Epic 6 `PriceDropAlertWorker` trigger. When the owner updates their price via `updateOwnerPrice()` and a campaign with `price_drop_notify: true` is ACTIVE:

```typescript
// In PartnerService.updateOwnerPrice() — after cache invalidation and campaign resume check:
if (campaign?.price_drop_notify) {
  // Enqueue a price drop alert check for this station
  // Same queue as Story 6.1 PriceDropAlertWorker
  await this.priceDropAlertQueue.add('owner-price-drop', {
    stationId,
    fuelType,
    newPrice: price,
    source: 'owner_promotion',  // tag so the notification copy can be adjusted
  });
}
```

**Notification copy** — extend `PriceDropAlertWorker` to handle `source: 'owner_promotion'`:
- Subject: `"[Station name] obniżył cenę [fuelType] do [price] PLN/L"` (pl)
- Body same as standard price drop alert

**If this is out of scope for now:** Include a `// TODO: Story 8.2 price-drop notification` comment in `PromotionService.resumeCampaignsForStation()` and skip implementation. The AC is optional and marked as such in the story.

---

## Tasks / Subtasks

- [ ] API: Extend GET /v1/stations/nearby response with `is_promoted` (AC: 1, 4, 5)
  - [ ] Batch query for active PromotionCampaign ids after fetching stations
  - [ ] Map `is_promoted` onto StationDto response
  - [ ] Update NestJS station response type/serialiser

- [ ] Mobile: Extend StationDto type (AC: 1, 3, 5)
  - [ ] Add `is_promoted: boolean` to `StationDto` in `apps/mobile/src/api/stations.ts`

- [ ] Mobile: StationPin promoted treatment (AC: 1)
  - [ ] Add `isPromoted?: boolean` prop to `StationPin`
  - [ ] PIN_SIZE_PROMOTED = 42 constant
  - [ ] Gold border ring when isPromoted
  - [ ] Star badge overlay (absolute positioned, top-right)
  - [ ] Pass `isPromoted={station.is_promoted}` in `index.tsx` map loop

- [ ] Mobile: StationDetailSheet sponsored badge (AC: 3)
  - [ ] Render "Sponsored" pill below station name when `displayStation?.is_promoted`
  - [ ] Styles: amber background, amber border, amber-800 text
  - [ ] i18n: pl/en/uk keys for `station.sponsored`

- [ ] Mobile: StationListSheet + StationListCard (AC: 2)
  - [ ] `StationListCard.tsx` — organic vs promoted card variants
  - [ ] `StationListSheet.tsx` — Modal bottom sheet with ScrollView
  - [ ] List toggle button in map top bar (`index.tsx`)
  - [ ] i18n key for `map.stationListTitle`

- [ ] Mobile: i18n strings (AC: 7)
  - [ ] Add `station.sponsored` and `map.stationListTitle` to pl/en/uk locale files

- [ ] Optional: Price-drop push notification (AC: 6)
  - [ ] Add `// TODO` comment in `resumeCampaignsForStation()` or implement Epic 6 queue enqueue

---

## Dev Notes

### StationPin — Rotation + Overlay Positioning

The `StationPin` inner `View` applies `transform: [{ rotate: '-45deg' }]`. When adding the star badge overlay, place it on the **outer** container `View` (not the rotated inner), otherwise the badge will also rotate. Use `position: 'absolute'` on the badge `View` within the outer container.

The outer container `View` has `width: size, height: containerHeight` (containerHeight > size to accommodate the tip). The badge should be at `top: -4, right: -4` relative to the outer container.

### Promoted Stations and Map Rank

Stations are rendered in the order returned by `GET /v1/stations/nearby`, which sorts by distance. Promoted stations must NOT be moved to the front of this array. The visual treatment (`isPromoted`) is a display-only flag — no sorting change anywhere in the stack.

### MarkerView Z-Index for Promoted Pins

Mapbox `MarkerView` renders in DOM order. Promoted pins (larger) should render ON TOP of nearby organic pins to avoid being clipped. Sort the `stations.map()` render order so promoted stations render last (appear on top):

```typescript
// In index.tsx, before rendering:
const sortedStations = useMemo(() => [
  ...stations.filter(s => !s.is_promoted),
  ...stations.filter(s => s.is_promoted),
], [stations]);
// Use sortedStations.map(...) instead of stations.map(...)
```

This does NOT change the station list order (list is sorted by distance independently).

### StationListSheet — Promoted Card Width

`StationListCard` for promoted stations shows ALL available fuel prices. Render them as a horizontal row of `FuelBadge` + price text pairs, wrapping with `flexWrap: 'wrap'`. Do not use `FlatList` for the internal fuel row — just a `View` with `flexDirection: 'row'` and `flexWrap: 'wrap'`.

### Performance: is_promoted Batch Query

The batch query for promoted status adds one extra DB query per `/v1/stations/nearby` call. The query hits `@@index([station_id, status])` (defined in Story 8.1 schema). For the current scale (<100 stations per response), this is negligible. Add query logging in dev mode to verify.

### BrandLogo Component

The existing `BrandLogo` component in `apps/mobile/src/components/BrandLogo.tsx` accepts a `brand` prop. It already handles null/unknown brands. No changes needed — reuse directly in `StationListCard`.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
