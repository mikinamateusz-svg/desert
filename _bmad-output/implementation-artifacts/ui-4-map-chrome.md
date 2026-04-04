# Story UI-4: Map Chrome — Top Bar, Floating Controls & Consistent Overlays

Status: done

## Story

As a **driver**,
I want the map to have a clean top bar with the app name and quick-access controls,
So that the app feels branded and complete, and I can reach alerts and settings in one tap.

## Why

The current map screen has no chrome at all — no brand identity, no controls, nothing. Loading and
error states use a dark overlay. The agreed design adds a minimal white top bar (wordmark + bell +
hamburger) and a GPS re-centre FAB, while keeping the map as the clear hero.

**Locked map chrome design:**

```
┌─────────────────────────────┐
│  status bar (dark icons)    │
│  litr●          [🔔]  [☰]  │  ← top bar, white, insets.top + 44dp
├─────────────────────────────┤
│                             │
│          MAP                │
│                             │
│                       [📍]  │  ← GPS FAB, bottom-right
├─────────────────────────────┤
│    Map  │  Activity  │  Log │  ← tab bar
└─────────────────────────────┘
```

- **Top bar:** white, subtle shadow only (no border), `insets.top + 44dp` tall
  - Left: wordmark `litr` + amber `o` (`tokens.brand.accent`)
  - Right: bare bell icon button (44×44dp hit area) + bare hamburger icon button
- **Bottom-right:** GPS re-centre FAB, amber, 48×48dp
- **Loading overlay:** starts below top bar — bar stays accessible during load
- **No fuel-type chip** in this story (Story 2.4)
- **Reference:** [ui-4-map-chrome-mockup.html](../../planning-artifacts/ui-4-map-chrome-mockup.html)

## Acceptance Criteria

1. **Given** the map screen **When** rendered **Then** a white top bar spanning the full width
   is visible at the top, containing the wordmark `litro` (amber `o`) on the left and bell +
   hamburger icon buttons on the right.

2. **Given** the top bar **When** rendered **Then** its height equals `useSafeAreaInsets().top + 44`,
   its background is `tokens.surface.card` (`#ffffff`), and it has a subtle shadow
   (`shadowOpacity: 0.08`) with no bottom border. `zIndex: 40`.

3. **Given** the user taps the bell button **When** navigated **Then**
   `router.push('/(app)/alerts')` fires. The Alerts screen opens with a native back button.
   Tab bar is not visible on that screen.

4. **Given** the user taps the hamburger button **When** navigated **Then**
   `router.push('/(app)/account')` fires. The Account screen opens with a native back button.
   Tab bar is not visible on that screen.

5. **Given** the map is loading **When** the overlay shows **Then** the overlay starts **below**
   the top bar (`top: insets.top + 44`), background is `rgba(253,246,238,0.93)` (warm, not dark),
   amber `ActivityIndicator`, text in `tokens.brand.ink`. Top bar remains interactive.

6. **Given** the user has panned away from their GPS location **When** they tap the GPS FAB
   **Then** the camera animates back to the current GPS location. If GPS is unavailable the FAB
   shows at 40% opacity and tapping has no effect.

7. **Given** the GPS FAB **When** rendered **Then** it is a 48×48dp amber circle with a white
   `navigate` Ionicon (size 22), positioned `bottom: 70` (58dp tab bar + 12dp gap), `right: 14`.

8. **Given** a stations API error **When** shown **Then** a white card banner appears above the
   FAB (`bottom: 130`), with a 4dp left border in `tokens.price.expensive`, auto-dismisses after 4s.

9. **Given** location permission is denied **When** shown **Then** a white card banner appears
   flush below the top bar (`top: insets.top + 44 + 8`), 4dp left border in `tokens.brand.accent`,
   with a dismiss ✕ button.

10. **Given** `StatusBar` **When** map screen is active **Then** `barStyle="dark-content"` with
    `translucent backgroundColor="transparent"`.

11. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

**Prerequisites:** UI-1 tokens exist. UI-2 complete (Alerts and Account routes registered as
`href: null`, accessible via `router.push`).

### Phase 1 — Imports & safe area hook

- [ ] **1.1** Add imports to `apps/mobile/app/(app)/index.tsx`:

```ts
import { StatusBar } from 'react-native';
import { router } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens } from '../../src/theme';
```

- [ ] **1.2** Add the insets hook inside `MapScreen`:

```ts
const insets = useSafeAreaInsets();
const topBarHeight = insets.top + 44;
```

### Phase 2 — Top bar

- [ ] **2.1** Add `<StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />`
  as the first child of the outer `View`.

- [ ] **2.2** Add the top bar JSX after `MapView` (it floats above the map via `position: 'absolute'`):

```tsx
{/* Top bar */}
<View style={[styles.topBar, { paddingTop: insets.top }]}>
  <Text style={styles.wordmark}>
    litr<Text style={styles.wordmarkAccent}>o</Text>
  </Text>
  <View style={styles.topBarActions}>
    <TouchableOpacity
      style={styles.topBarButton}
      onPress={() => router.push('/(app)/alerts')}
      accessibilityLabel={t('map.openAlerts')}
    >
      <Ionicons name="notifications-outline" size={22} color={tokens.brand.ink} />
    </TouchableOpacity>
    <TouchableOpacity
      style={styles.topBarButton}
      onPress={() => router.push('/(app)/account')}
      accessibilityLabel={t('map.openMenu')}
    >
      <Ionicons name="menu" size={22} color={tokens.brand.ink} />
    </TouchableOpacity>
  </View>
</View>
```

- [ ] **2.3** Add styles:

```ts
topBar: {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 40,
  height: undefined,           // height is dynamic via paddingTop + paddingBottom
  paddingBottom: 10,
  paddingHorizontal: 16,
  backgroundColor: tokens.surface.card,
  flexDirection: 'row',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 3,
},
wordmark: {
  fontSize: 20,
  fontWeight: '800',
  color: tokens.brand.ink,
  letterSpacing: -0.5,
},
wordmarkAccent: {
  color: tokens.brand.accent,
},
topBarActions: {
  flexDirection: 'row',
},
topBarButton: {
  width: 44,
  height: 44,
  alignItems: 'center',
  justifyContent: 'center',
},
```

### Phase 3 — GPS re-centre FAB

- [ ] **3.1** Add `programmaticMoveRef` and `isAtGpsLocation` state:

```ts
const [isAtGpsLocation, setIsAtGpsLocation] = useState(true);
const programmaticMoveRef = useRef(false);
```

- [ ] **3.2** In the location `useEffect`, mark camera moves as programmatic before calling
  `setCameraCenter`:

```ts
// GPS resolved:
programmaticMoveRef.current = true;
setCameraCenter([location.lng, location.lat]);
setIsAtGpsLocation(true);

// Warsaw fallback (permission denied or timeout):
programmaticMoveRef.current = true;
setFetchCenter(WARSAW);
```

- [ ] **3.3** Update `handleRegionChange` to detect user-initiated pans:

```ts
const handleRegionChange = (feature: GeoJSON.Feature<GeoJSON.Point>) => {
  if (programmaticMoveRef.current) {
    programmaticMoveRef.current = false;
    return;
  }
  setIsAtGpsLocation(false);
  if (debounceRef.current) clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => {
    const [lng, lat] = feature.geometry.coordinates;
    setFetchCenter({ lat, lng });
  }, 500);
};
```

- [ ] **3.4** Add `handleRecentre`:

```ts
const handleRecentre = () => {
  if (!location) return;
  programmaticMoveRef.current = true;
  setCameraCenter([location.lng, location.lat]);
  setIsAtGpsLocation(true);
};
```

- [ ] **3.5** Add FAB JSX (after the top bar):

```tsx
{/* GPS re-centre FAB */}
<TouchableOpacity
  style={[styles.recentreFab, !location && styles.recentreFabDisabled]}
  onPress={handleRecentre}
  disabled={!location}
  accessibilityLabel={t('map.recentre')}
>
  <Ionicons name="navigate" size={22} color={tokens.neutral.n0} />
</TouchableOpacity>
```

- [ ] **3.6** Add FAB styles:

```ts
recentreFab: {
  position: 'absolute',
  bottom: 70,
  right: 14,
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: tokens.brand.accent,
  alignItems: 'center',
  justifyContent: 'center',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.20,
  shadowRadius: 4,
  elevation: 4,
},
recentreFabDisabled: {
  opacity: 0.4,
},
```

### Phase 4 — Loading overlay (warm, below top bar)

- [ ] **4.1** Replace `...StyleSheet.absoluteFillObject` with a dynamic top offset so the
  overlay starts below the top bar. Change the loading overlay JSX to:

```tsx
{showLoadingOverlay && (
  <View
    style={[styles.loadingOverlay, { top: topBarHeight }]}
    pointerEvents="none"
  >
    <ActivityIndicator size="large" color={tokens.brand.accent} />
    <Text style={styles.loadingText}>{t('map.loadingMap')}</Text>
  </View>
)}
```

- [ ] **4.2** Update style:

```ts
loadingOverlay: {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  // top is set dynamically via topBarHeight in JSX
  backgroundColor: 'rgba(253,246,238,0.93)',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 12,
},
loadingText: {
  color: tokens.brand.ink,
  fontSize: 14,
  fontWeight: '500',
},
```

### Phase 5 — Error banner (auto-dismiss card)

- [ ] **5.1** Add state and dismiss timer:

```ts
const [errorBannerVisible, setErrorBannerVisible] = useState(false);
const errorDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **5.2** Add effect:

```ts
useEffect(() => {
  if (stationsError) {
    setErrorBannerVisible(true);
    if (errorDismissRef.current) clearTimeout(errorDismissRef.current);
    errorDismissRef.current = setTimeout(() => setErrorBannerVisible(false), 4000);
  }
  return () => { if (errorDismissRef.current) clearTimeout(errorDismissRef.current); };
}, [stationsError]);
```

- [ ] **5.3** Replace the existing error banner JSX:

```tsx
{errorBannerVisible && (
  <View style={styles.errorBanner} pointerEvents="none">
    <Text style={styles.errorBannerText}>{t('map.stationsLoadError')}</Text>
  </View>
)}
```

- [ ] **5.4** Style:

```ts
errorBanner: {
  position: 'absolute',
  bottom: 130,   // above FAB (48) + gap (12) + some buffer
  left: 14,
  right: 14,
  backgroundColor: tokens.surface.card,
  borderRadius: tokens.radius.md,
  borderLeftWidth: 4,
  borderLeftColor: tokens.price.expensive,
  paddingVertical: 12,
  paddingHorizontal: 14,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.10,
  shadowRadius: 4,
  elevation: 3,
},
errorBannerText: {
  color: tokens.brand.ink,
  fontSize: 13,
},
```

### Phase 6 — Location denied banner (card, below top bar)

- [ ] **6.1** Replace the location denied banner JSX. Top offset is dynamic:

```tsx
{locationDeniedVisible && (
  <View style={[styles.locationDeniedBanner, { top: topBarHeight + 8 }]}>
    <Text style={styles.locationDeniedText}>{t('map.locationDenied')}</Text>
    <TouchableOpacity
      onPress={() => setLocationDeniedVisible(false)}
      style={styles.locationDeniedDismiss}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="close" size={18} color={tokens.neutral.n400} />
    </TouchableOpacity>
  </View>
)}
```

- [ ] **6.2** Style:

```ts
locationDeniedBanner: {
  position: 'absolute',
  // top is set dynamically via topBarHeight + 8 in JSX
  left: 14,
  right: 14,
  backgroundColor: tokens.surface.card,
  borderRadius: tokens.radius.md,
  borderLeftWidth: 4,
  borderLeftColor: tokens.brand.accent,
  paddingVertical: 12,
  paddingHorizontal: 14,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.10,
  shadowRadius: 4,
  elevation: 3,
},
locationDeniedText: {
  color: tokens.brand.ink,
  fontSize: 13,
  flex: 1,
  marginRight: 8,
},
locationDeniedDismiss: {
  padding: 2,
},
```

### Phase 7 — Cleanup

- [ ] **7.1** Delete the now-unused styles from `StyleSheet.create`:
  `locationDeniedDismissText`

- [ ] **7.2** Remove the old `container backgroundColor: '#1a1a1a'` — replace with
  `tokens.surface.warmPage` (`#fdf6ee`) so the brief flash before the map tiles load is warm,
  not dark.

### Phase 8 — i18n

- [ ] **8.1** Add to all three locales:

  **en.ts:** `map.openAlerts: 'Open alerts'`, `map.openMenu: 'Open menu'`, `map.recentre: 'Re-centre map'`

  **pl.ts:** `map.openAlerts: 'Otwórz alerty'`, `map.openMenu: 'Otwórz menu'`, `map.recentre: 'Wróć do mojej lokalizacji'`

  **uk.ts:** `map.openAlerts: 'Відкрити сповіщення'`, `map.openMenu: 'Відкрити меню'`, `map.recentre: 'Повернутися до моєї локації'`

### Phase 9 — Verify

- [ ] **9.1** Top bar visible: wordmark `litro` with amber `o`, bell + hamburger on right.
- [ ] **9.2** Bell → Alerts screen with back button; no tab bar on Alerts.
- [ ] **9.3** Hamburger → Account screen with back button; no tab bar on Account.
- [ ] **9.4** Pan map → FAB active; tap → re-centres. GPS denied → FAB at 40%.
- [ ] **9.5** Force stations error → white card banner above FAB, auto-dismisses after 4s.
- [ ] **9.6** Deny location → amber-bordered card below top bar, dismisses via ✕.
- [ ] **9.7** Loading overlay starts below top bar; bar remains interactive.
- [ ] **9.8** Container background flash is warm (`#fdf6ee`), not dark.
- [ ] **9.9** `tsc --noEmit` passes.

## Definition of Done

- Top bar: white, `insets.top + 44dp`, wordmark with amber `o`, bare bell + hamburger icon buttons
- Loading overlay starts below top bar, warm background, amber spinner, dark text
- GPS FAB: amber, bottom-right, fades at 40% without GPS
- Error banner: white card, red left border, auto-dismisses in 4s
- Location denied banner: white card, amber left border, dynamic offset below top bar
- `StatusBar` dark-content translucent
- Container background `tokens.surface.warmPage`
- All i18n keys in EN, PL, UK
- `tsc --noEmit` passes

## Review Notes (2026-04-04)

No patches to chrome itself. P-1 bug found in map data loading (see ui-5 / useNearbyStations).
