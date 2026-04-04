# Story 2.5: Station Detail Screen

Status: done

## Story

As a **driver**,
I want to tap a station pin and see its full price breakdown,
So that I can make an informed decision before driving there.

## Why

The map gives a quick colour-coded overview, but the decision screen is where drivers
actually commit: they need the exact price per litre for every available fuel type and a
sense of how fresh the data is before choosing a route. This sheet is also the natural
home for the Navigate CTA — one tap to the device's default maps app.

## Scope

- **In:** station name, address, per-fuel-type price list, data freshness (relative time),
  Navigate CTA, no-prices empty state.
- **Out:** contribution/submit flow (Epic 3), verified vs estimated badges (Story 2.6),
  arrival detection / 200m proximity banner (deferred — requires Epic 3 navigation state),
  AdBlue fuel type (deferred to Story 2.7), analytics events (deferred to separate story).
- The spec says "sole CTA is Navigate →" — no "Update prices" or "Add price" button inside
  the sheet at this stage.

## Data Available

```ts
// From useNearbyStations hook (cached, always available)
StationDto {
  id: string
  name: string
  address: string | null
  lat: number
  lng: number
  google_places_id: string | null
}

// From useNearbyPrices hook (requires accessToken — null for guests)
StationPriceDto {
  stationId: string
  prices: Partial<Record<FuelType, number>>  // only fuel types with known prices present
  updatedAt: string  // ISO 8601
}
```

Guests (no `accessToken`) receive no price data — `prices` array in the hook is empty.
The sheet must handle this gracefully.

## Acceptance Criteria

1. **Given** a driver taps a station pin
   **When** the tap registers
   **Then** a bottom sheet slides up showing the station name and address (or "Address not
   available" if `address` is null).

2. **Given** a station has price data
   **When** the detail sheet is open
   **Then** one row per fuel type is shown — only fuel types with a known price are
   displayed; no placeholder rows for unknown types. Fuel type order: PB 95, PB 98, ON,
   ON+, LPG (canonical order, matching pill bar).

3. **Given** prices are displayed
   **When** the sheet renders
   **Then** each price row shows the fuel type label (using `fuelTypes.*` i18n keys) and
   the price formatted as `X.XX zł/l` (two decimal places, Polish złoty suffix).

4. **Given** a station has price data
   **When** the detail sheet is open
   **Then** a single freshness line is shown below the price list: "Updated X ago" where X
   is derived from `StationPriceDto.updatedAt` — rounded to the nearest sensible unit
   (minutes, hours, or days). Full freshness design (verified vs estimated) deferred to
   Story 2.6.

5. **Given** a station has no price data (guest user, or no submissions yet)
   **When** the detail sheet is open
   **Then** a "No prices yet" empty state is shown with a subtle prompt. No error banner,
   no spinner — just the empty state copy.

6. **Given** a driver taps the "Navigate" button
   **When** the deep-link fires
   **Then** the device's default maps app opens with the station coordinates as the
   destination: `maps://?daddr=<lat>,<lng>` on iOS; `geo:<lat>,<lng>?q=<lat>,<lng>` on
   Android. If the native scheme is not available, fall back to
   `https://maps.google.com/?daddr=<lat>,<lng>`.

7. **Given** a driver taps the backdrop or uses the back gesture
   **When** the sheet dismisses
   **Then** the map returns to its normal state with no selected station.

8. **Given** the sheet is open on any locale
   **When** the user's language is EN, PL, or UK
   **Then** all copy (title fallback, freshness label, empty state, Navigate button) is
   translated via the new `stationDetail.*` i18n keys.

9. **Given** `tsc --noEmit`
   **When** run
   **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — Relative-time utility

- [x] **1.1** Create `apps/mobile/src/utils/relativeTime.ts`:
  ```ts
  export function relativeTime(isoString: string): string {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diffMs / 60_000);
    const hours   = Math.floor(diffMs / 3_600_000);
    const days    = Math.floor(diffMs / 86_400_000);
    if (minutes < 2)  return 'just now';
    if (minutes < 60) return `${minutes}m`;
    if (hours   < 24) return `${hours}h`;
    return `${days}d`;
  }
  ```
  > Returns a bare token (`5m`, `3h`, `2d`, `just now`). The calling component wraps it
  > with the localised `t('stationDetail.updatedAgo', { time })` pattern.
  > If `isoString` is unparseable, return `'?'` (NaN guard).

### Phase 2 — StationDetailSheet component

- [x] **2.1** Create `apps/mobile/src/components/StationDetailSheet.tsx`:

  Props:
  ```ts
  interface Props {
    station: StationDto | null;
    prices: StationPriceDto | null;
    onDismiss: () => void;
  }
  ```

  `visible = station !== null`.

  Layout (same modal + handle pattern as `FuelTypePickerSheet`):
  - Modal `transparent`, `animationType="slide"`, `onRequestClose={onDismiss}`
  - Container `flex:1 justifyContent:'flex-end'`
  - Backdrop `Pressable` with `StyleSheet.absoluteFill`, `onPress={onDismiss}`
  - Sheet `View` with `accessibilityViewIsModal`, `paddingBottom: Math.max(insets.bottom, 24)`
  - Handle bar (40×4, `tokens.neutral.n200`, centred)

  Header section:
  - Station name: `fontSize: 18, fontWeight: '700', color: tokens.brand.ink`
  - Address: `fontSize: 13, color: tokens.neutral.n500` — show `t('stationDetail.noAddress')`
    if `station.address` is null

  Price list (when prices available and `Object.keys(prices.prices).length > 0`):
  - Iterate `VALID_FUEL_TYPES` (imported from `useFuelTypePreference`); render a row only
    when `prices.prices[ft]` is defined
  - Each row: `flexDirection:'row', justifyContent:'space-between'`
    - Left: fuel type label `t('fuelTypes.${ft}')`
    - Right: `${price.toFixed(2)} zł/l`
  - Freshness line below rows: `t('stationDetail.updatedAgo', { time: relativeTime(prices.updatedAt) })`

  Empty state (when no prices):
  - `t('stationDetail.noPrices')` — centred, `tokens.neutral.n400`

  Footer:
  - "Navigate" button: full-width, `backgroundColor: tokens.brand.accent`,
    `borderRadius: tokens.radius.md`, `paddingVertical: 14`
  - `onPress`: calls `handleNavigate(station.lat, station.lng)`

  `handleNavigate` function inside component:
  ```ts
  const handleNavigate = useCallback(async (lat: number, lng: number) => {
    const iosUrl     = `maps://?daddr=${lat},${lng}`;
    const androidUrl = `geo:${lat},${lng}?q=${lat},${lng}`;
    const webUrl     = `https://maps.google.com/?daddr=${lat},${lng}`;
    const native = Platform.OS === 'ios' ? iosUrl : androidUrl;
    const canOpen = await Linking.canOpenURL(native);
    await Linking.openURL(canOpen ? native : webUrl);
  }, []);
  ```

### Phase 3 — Wire up in index.tsx

- [x] **3.1** Add state:
  ```ts
  const [selectedStation, setSelectedStation] = useState<StationDto | null>(null);
  ```
  Remove the `console.log` stub from `handlePinPress` and replace with:
  ```ts
  const handlePinPress = useCallback((event: OnPressEvent) => {
    const stationId = event.features[0]?.properties?.['id'] as string | undefined;
    if (!stationId) return;
    const station = stations.find(s => s.id === stationId) ?? null;
    setSelectedStation(station);
  }, [stations]);
  ```

- [x] **3.2** Derive `selectedStationPrices` via `useMemo`:
  ```ts
  const selectedStationPrices = useMemo(
    () => selectedStation
      ? (prices.find(p => p.stationId === selectedStation.id) ?? null)
      : null,
    [selectedStation, prices],
  );
  ```

- [x] **3.3** Render `StationDetailSheet` after `FuelTypePickerSheet` in the JSX:
  ```tsx
  <StationDetailSheet
    station={selectedStation}
    prices={selectedStationPrices}
    onDismiss={() => setSelectedStation(null)}
  />
  ```

### Phase 4 — i18n

- [x] **4.1** Add `stationDetail` namespace to `en.ts`, `pl.ts`, `uk.ts`:

  EN:
  ```ts
  stationDetail: {
    noAddress: 'Address not available',
    updatedAgo: 'Updated {{time}} ago',
    noPrices: 'No prices yet',
    navigate: 'Navigate →',
  },
  ```
  PL:
  ```ts
  stationDetail: {
    noAddress: 'Adres niedostępny',
    updatedAgo: 'Zaktualizowano {{time}} temu',
    noPrices: 'Brak cen',
    navigate: 'Nawiguj →',
  },
  ```
  UK:
  ```ts
  stationDetail: {
    noAddress: 'Адреса недоступна',
    updatedAgo: 'Оновлено {{time}} тому',
    noPrices: 'Цін ще немає',
    navigate: 'Навігація →',
  },
  ```

  > Note: `relativeTime()` returns bare tokens (`5m`, `3h`, `2d`, `just now`). The `just now`
  > case should bypass the `updatedAgo` wrapper — use
  > `time === 'just now' ? t('stationDetail.justNow') : t('stationDetail.updatedAgo', { time })`
  > and add `justNow` key: EN `'Just now'`, PL `'Przed chwilą'`, UK `'Щойно'`.

### Phase 5 — Final checks

- [x] **5.1** `tsc --noEmit` — zero errors.
- [ ] **5.2** Device smoke test:
  - Tap pin → sheet slides up with name, address, prices ✓
  - Tap pin on station with no prices (guest, or unpopulated station) → empty state shown ✓
  - Tap Navigate → device maps app opens with correct coordinates ✓
  - Tap backdrop → sheet dismisses ✓
  - Test EN / PL / UK locale ✓

## Definition of Done

- `StationDetailSheet` renders station name, address, per-fuel price rows, freshness line
- Only fuel types with data are shown — no placeholder rows
- Empty state shown when no price data is available
- Navigate deep-links to device maps app (iOS + Android + web fallback)
- `stationDetail.*` i18n keys in EN / PL / UK
- `relativeTime` utility with NaN guard
- `tsc --noEmit` passes
- `handlePinPress` stub removed; actual sheet wired in `index.tsx`

## Intent Gap — Contribution CTA

The epics spec mentions a secondary "Update prices" prompt in the station sheet, alongside
an "Add price" button on the map. Both are Entry Points for Epic 3 (price submission).
Since Epic 3 is not yet implemented, this story ships with Navigate as the sole CTA.
The contribution flow will be added when Epic 3 is picked up.

## Deferred

- **Arrival detection / 200m proximity banner** — requires Epic 3 navigation state
  tracking and an app-foreground listener. Defer until after price submission is live.
- **Verified vs estimated price badges** — Story 2.6.
- **AdBlue** — Story 2.7.
- **Analytics event `station_detail_viewed`** — separate analytics story.

## Review Notes (2026-04-04)

No new patches. Prior review applied all patches — see sprint-status.yaml for details.
