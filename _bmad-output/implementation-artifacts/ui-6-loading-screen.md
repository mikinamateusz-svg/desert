# Story UI-6: Loading Screen — Fuel Drop Splash

Status: dev_complete

## Story

As a **driver opening the app**,
I want to see a branded, animated loading screen while the app resolves my location and fetches
nearby stations and prices,
So that the first seconds feel intentional and on-brand rather than blank or jarring.

## Why

The map screen currently shows a semi-transparent `ActivityIndicator` overlay after the map has
already started rendering underneath — which is visually inconsistent and does not communicate
*what* is loading or *how far along* the process is.

A proper branded splash with a progress metaphor (a fuel drop that fills up as the app loads)
replaces the overlay, gives the user a clear signal of progress across three distinct stages, and
reinforces the litro brand from the very first frame.

## Design Notes

**Visual concept — Fuel Drop (Variant A):**
- Full-screen `tokens.surface.warmPage` background (`#fdf6ee`)
- "litro" wordmark centred, `tokens.brand.ink` with `tokens.brand.accent` "o"
- A tall pill/oval shape (72×96 dp) below the wordmark
  - Fill state: `tokens.neutral.n200` (empty/grey)
  - Fill colour: `tokens.brand.accent` (amber, rises from bottom)
  - 2.5pt ring in `tokens.neutral.n200` drawn on top to create an outline effect
- A small stage label below the drop in `tokens.neutral.n400` (e.g. "Finding stations...")
- Smooth fade-out into the map once all data is ready

**Loading stages and fill targets:**

| Stage      | Trigger                             | Fill % | Label (EN)          |
|------------|-------------------------------------|--------|---------------------|
| `gps`      | Initial (app open)                  | 0%     | "Locating you..."   |
| `stations` | `fetchCenter` set (GPS/fallback)    | 40%    | "Finding stations..." |
| `prices`   | First station batch received        | 75%    | "Fetching prices..."  |
| `done`     | Both stations + prices received     | 100%   | "Ready"             |

Fill animation: `Animated.timing` 700ms per stage transition.
On `done`: fill to 100% (400ms) → 200ms hold → fade screen out (350ms) → call `onHidden`.

**Reference preview:** `_bmad-output/planning-artifacts/splash-screen-preview.html`

## Acceptance Criteria

1. **Given** the app cold-launches **When** the map screen mounts **Then** a full-screen splash
   covers the map with `tokens.surface.warmPage` background; the map is not visible behind it.

2. **Given** the splash is visible **When** it renders **Then** the "litro" wordmark is centred
   with the "o" in `tokens.brand.accent`, consistent with the top-bar wordmark style.

3. **Given** the splash is visible **When** GPS is still resolving **Then** the fuel drop fill
   level is 0% (empty, grey) and the label reads `t('loading.gps')`.

4. **Given** GPS resolves or falls back to Warsaw **When** `fetchCenter` becomes non-null **Then**
   the fill animates to ≥40% and the label updates to `t('loading.stations')`.

5. **Given** the first station batch arrives **When** `stations.length > 0` **Then** the fill
   animates to ≥75% and the label updates to `t('loading.prices')`.

6. **Given** both stations and prices have arrived **When** `stations.length > 0 && prices.length > 0`
   **Then** the fill animates to 100%, holds briefly, then the splash fades out and the map
   is revealed.

7. **Given** the splash has fully faded out **When** `onHidden` fires **Then** the `LoadingScreen`
   component is unmounted from the tree (parent sets `splashVisible = false`).

8. **Given** the splash is visible **When** the app is in any locale (EN / PL / UK) **Then** the
   stage label renders in the correct language via the `loading.*` i18n namespace.

9. **Given** the `LoadingScreen` component **When** it unmounts mid-animation **Then** no
   `setState` calls fire after unmount (animations are driven by `Animated.Value` — no leaked
   timers or setState on unmounted components).

10. **Given** `tsc --noEmit` **When** run on `apps/mobile` **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — LoadingScreen component

- [x] **1.1** Create `apps/mobile/src/components/LoadingScreen.tsx`

  - Export `LoadingStage = 'gps' | 'stations' | 'prices' | 'done'`
  - Props: `stage: LoadingStage`, `onHidden: () => void`
  - `fillAnim` (`Animated.Value`) interpolated to `DROP_HEIGHT` (96 dp) at progress 1.0
  - Stage → progress map: `gps=0.0`, `stations=0.4`, `prices=0.75`, `done=1.0`
  - `screenAnim` (`Animated.Value`) for full-screen fade-out (native driver ✓)
  - `fillAnim` cannot use native driver (height animation) — explicitly `useNativeDriver: false`

- [x] **1.2** Drop shape: outer `View` (72×96, `borderRadius: 36`, `overflow: 'hidden'`)
  containing:
  - `dropBackground` — `StyleSheet.absoluteFillObject`, `backgroundColor: tokens.neutral.n200`
  - `dropFill` — absolute bottom, animated height, `backgroundColor: tokens.brand.accent`
  - `dropOutline` — `StyleSheet.absoluteFillObject`, border only (2.5pt, `tokens.neutral.n200`),
    transparent fill; drawn last so it sits on top of the amber fill

- [x] **1.3** Stage label: `Text` in `tokens.neutral.n400`, 13pt, 500 weight, fixed height to
  prevent layout shift between label strings.

- [x] **1.4** On `stage === 'done'`: run `Animated.sequence([fillTo100, delay200, fadeOut350])`
  then call `onHidden()` in the completion callback.

- [x] **1.5** Use `useSafeAreaInsets` for `paddingBottom` so the wordmark stays centred on
  notched devices.

### Phase 2 — i18n keys

- [x] **2.1** Add `loading` namespace to `apps/mobile/src/i18n/locales/en.ts`:
  ```ts
  loading: {
    gps:      'Locating you...',
    stations: 'Finding stations...',
    prices:   'Fetching prices...',
    done:     'Ready',
  },
  ```

- [x] **2.2** Add Polish translations to `pl.ts`:
  ```ts
  loading: {
    gps:      'Szukam Cię...',
    stations: 'Szukam stacji...',
    prices:   'Pobieram ceny...',
    done:     'Gotowe',
  },
  ```

- [x] **2.3** Add Ukrainian translations to `uk.ts`:
  ```ts
  loading: {
    gps:      'Шукаю вас...',
    stations: 'Шукаю станції...',
    prices:   'Завантажую ціни...',
    done:     'Готово',
  },
  ```

### Phase 3 — Integration in map screen

- [x] **3.1** Add `loadingStage: LoadingStage` state (initial: `'gps'`) and `splashVisible: boolean`
  state (initial: `true`) to `MapScreen`.

- [x] **3.2** Add `handleSplashHidden` callback (`useCallback`) that sets `splashVisible = false`.

- [x] **3.3** Add `useEffect` that advances `loadingStage` based on `fetchCenter`, `stations.length`,
  `prices.length` — only runs while `splashVisible` is true to prevent re-triggering after dismissal.

- [x] **3.4** Replace old `ActivityIndicator` loading overlay JSX with:
  ```tsx
  {splashVisible && (
    <LoadingScreen stage={loadingStage} onHidden={handleSplashHidden} />
  )}
  ```

- [x] **3.5** Remove now-unused `loadingStations` destructure from `useNearbyStations` and remove
  the `loadingOverlay` / `loadingText` style entries from `StyleSheet.create`.

- [x] **3.6** Remove `ActivityIndicator` from the `react-native` import since it is no longer used.

### Phase 4 — Final checks

- [x] **4.1** `tsc --noEmit` — zero errors.

- [ ] **4.2** Visual smoke test on device:
  - Cold launch: empty drop visible, label "Locating you..."
  - GPS resolves: drop fills to ~40%, label updates
  - Stations arrive: drop fills to ~75%
  - Prices arrive: drop fills to 100%, fade to map
  - Repeat in PL and UK locale

- [ ] **4.3** Verify no visible map flash before splash fades (splash `zIndex: 100` covers map).

## Definition of Done

- `LoadingScreen` component exists at `apps/mobile/src/components/LoadingScreen.tsx`
- Splash covers the map on cold launch with `zIndex: 100` and `warmPage` background
- Fill animates through all four stages tied to real data arrival
- All three locales have `loading.*` keys
- `tsc --noEmit` passes with zero errors
- Old `ActivityIndicator` overlay removed from `index.tsx`
- Visual smoke test passes on device (AC 4.2 / 4.3)

## Review Notes (2026-04-04)

No new patches. Prior review (2026-03-25) applied P1–P5 patches. Clean.
