# Story UI-7: GPS Re-centre FAB — Bug Fix & Icon Update

Status: ready

## Story

As a **driver viewing the map**,
I want tapping the re-centre button to always fly the camera back to my current location,
So that I can instantly recover my position after panning, every time I tap it.

## Why

The re-centre FAB (`handleRecentre`) works by calling `setCameraCenter([location.lng, location.lat])`.
If the React state value hasn't changed since the last GPS fix (e.g. the camera was already centred
on the user's location when they started panning — the map view moves but the state variable stays
the same), React skips the re-render and the Camera component never animates.

The fix is to bypass the state-driven approach entirely and use the Mapbox `Camera` component's
**imperative ref API** (`cameraRef.current?.flyTo()`), which always triggers an animation
regardless of whether coordinates have changed.

The icon is also being updated from `navigate` (an arrow pointing northeast — implies direction of
travel) to `locate` (a crosshair/target — universally understood as "show me where I am"), matching
the pattern established by Google Maps and Apple Maps.

## Acceptance Criteria

1. **Given** the user has panned the map away from their GPS position **When** they tap the
   re-centre FAB **Then** the map camera always flies back to their current location, even if
   the coordinates haven't changed since the last tap.

2. **Given** the user taps re-centre multiple times in quick succession **When** each tap fires
   **Then** each tap triggers a fresh `flyTo` animation — no tap is silently swallowed.

3. **Given** GPS location is not available (permission denied or still resolving) **When** the
   FAB renders **Then** it is visually disabled (40% opacity) and does not respond to taps —
   unchanged from current behaviour.

4. **Given** the FAB **When** it renders **Then** the icon is `locate` (crosshair/target) not
   `navigate` (directional arrow).

5. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — Imperative camera ref

- [ ] **1.1** In `apps/mobile/app/(app)/index.tsx`, add a Camera ref:
  ```tsx
  import Mapbox, { MapView, Camera, ShapeSource, CircleLayer, type CameraRef } from '@rnmapbox/maps';
  // ...
  const cameraRef = useRef<CameraRef>(null);
  ```
  Attach it to the `Camera` component:
  ```tsx
  <Camera
    ref={cameraRef}
    defaultSettings={{ centerCoordinate: cameraCenter, zoomLevel: 13 }}
    centerCoordinate={cameraCenter}
    animationMode="flyTo"
    animationDuration={800}
  />
  ```

  > **Note:** If `CameraRef` is not exported from `@rnmapbox/maps`, use
  > `useRef<React.ElementRef<typeof Camera>>(null)` as a type-safe fallback.

- [ ] **1.2** Replace `handleRecentre` with the imperative version:
  ```tsx
  const handleRecentre = () => {
    if (!location) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [location.lng, location.lat],
      animationMode: 'flyTo',
      animationDuration: 800,
    });
  };
  ```

  > **Note:** `@rnmapbox/maps` Camera ref exposes `setCamera(config)`.
  > If `setCamera` is unavailable on the ref type, fall back to a state key trick:
  > add `const [cameraKey, setCameraKey] = useState(0)` and set
  > `key={cameraKey}` on `<Camera>` — incrementing the key forces remount and re-animation.
  > Only use the key trick if the ref approach fails to compile.

- [ ] **1.3** Remove the now-redundant `cameraCenter` state and `setCameraCenter` call inside
  `handleRecentre` — `cameraCenter` is still needed for the initial GPS/fallback camera position
  on first load, so keep the state and its setter in the GPS `useEffect`. Only remove the
  `setCameraCenter` call from `handleRecentre` itself.

### Phase 2 — Icon update

- [ ] **2.1** In the FAB `Ionicons`, change `name="navigate"` to `name="locate"`:
  ```tsx
  <Ionicons name="locate" size={22} color={tokens.neutral.n0} />
  ```

### Phase 3 — Final checks

- [ ] **3.1** `tsc --noEmit` — zero errors.

- [ ] **3.2** Device smoke test:
  - Pan map away from current location → tap FAB → camera flies back ✓
  - Tap FAB while already centred → camera still animates (flyTo fires) ✓
  - Deny location → FAB is disabled and greyed out ✓
  - Icon shows crosshair/target, not the northeast arrow ✓

## Definition of Done

- Re-centre FAB always animates the camera to current GPS location on tap
- No silent no-op when coordinates haven't changed in state
- Icon is `locate` (crosshair) not `navigate` (arrow)
- `tsc --noEmit` passes
- Device smoke test passes

## Review Notes (2026-04-04)

No new patches. Reviewed alongside UI-6 (2026-03-25). Clean.
