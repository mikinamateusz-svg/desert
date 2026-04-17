# Story 3.1: Camera Capture & Photo Pre-Processing

**Status:** ready-for-dev
**Epic:** 3 — Photo Contribution Pipeline
**Created:** 2026-04-01

---

## User Story

As a **driver**,
I want to take a photo of a price board directly from within the app,
So that I can contribute price data in one tap without switching to my camera app.

**Why:** The 10-second contribution UX depends on a frictionless in-app camera flow. Camera-only capture (no gallery upload) is a core data integrity mechanism — it prevents recycled or fabricated images from entering the pipeline. Pre-processing ensures consistent upload sizes and reduces OCR token costs regardless of device camera resolution.

---

## Acceptance Criteria

### AC1 — "Add price" FAB always visible on map
**Given** a driver is on the map screen
**When** the screen is displayed
**Then** a `MapFABGroup` component renders as an inline row above the tab bar:
- Left: `Cheapest in view` — white fill, light border, dark text (hidden when station detail sheet is open)
- Right: `＋ Add price` — `#1a1a1a` fill, white text, border-radius full
- `⛽ Log fill-up` removed in Phase 1 (deferred to Phase 2 — will stack above "Add price" on the right)
- Buttons always visible (no pan fade animation)

No station selection or pin tap is required — GPS matching happens automatically after capture.

### AC2 — Auth gate: guests cannot contribute
**Given** a guest user (not signed in) taps `＋ Add price`
**When** the tap is handled
**Then** the existing `SoftSignUpSheet` / sign-in flow is shown — camera does not open

### AC3 — Location permission gate
**Given** an authenticated driver taps `＋ Add price`
**When** location permission has NOT been granted
**Then** a `LocationRequiredScreen` is shown (full-screen, replaces camera) explaining that location is required to match the photo to a station, with a single CTA "Go to Settings" that deep-links to `Linking.openSettings()`

**Given** an authenticated driver taps `＋ Add price`
**When** location permission HAS been granted
**Then** proceed to camera permission check (AC4)

### AC4 — Camera permission gate
**Given** location permission is granted and driver taps `＋ Add price`
**When** camera permission has NOT been granted
**Then** `Camera.requestCameraPermissionsAsync()` is called; if denied, show an inline toast "Camera access denied. Please enable it in Settings." — camera does not open
**And** a "Go to Settings" link in the toast calls `Linking.openSettings()`

**Given** both location and camera permissions are granted
**When** all permission checks pass
**Then** navigate to the full-screen camera screen `/(app)/capture`

### AC5 — Camera-only capture (no gallery)
**Given** the camera screen is open
**When** it is displayed
**Then** only the device camera viewfinder is shown — the photo library/gallery is never accessible from this flow
**And** `expo-camera` renders in back-facing mode by default

### AC6 — CameraOverlay UI
**Given** the camera screen is open
**When** it is displayed
**Then** the overlay shows:
- **GPS station indicator** — top-center pill: `"📍 Orlen Grodzka · 80m"` if exactly one station found within 200m of current GPS; `"📍 Matching station…"` while GPS is resolving or if 0 results; no indicator if API/GPS error (fail silently)
- **Framing guide** — corner marks only (no full rectangle border) centred on viewfinder to guide price board framing
- **Cancel button** — top-left text button returns to map
- **Capture button** — 64dp white circle, bottom-centre; accessibilityLabel="Take photo", accessibilityRole="button"
- **Camera hardware error** — if `expo-camera` fails to initialise, show full-screen error state: "Camera unavailable" + dismiss button (returns to map)

The GPS indicator is informational only — it never blocks capture.

### AC7 — Photo quality check
**Given** a driver captures a photo
**When** it is captured
**Then** a lightweight quality check runs on the compressed image:
- Brightness check: if mean luminance is below threshold, show retake prompt "Photo may be too dark — retake for better results"
- Blur check (laplacian variance on downsampled grayscale): if variance is below threshold, show retake prompt "Photo may be too blurry — retake for better results"
- The driver is NEVER blocked — retake prompt has two buttons: "Retake" and "Use anyway"
- If "Use anyway" is tapped, proceed with the photo regardless of quality flag

### AC8 — Image compression
**Given** a photo passes quality check (or driver overrides)
**When** pre-processing runs
**Then** `expo-image-manipulator` compresses it to: max 1920px width, 75% JPEG quality (~200–500KB)
**And** the device storage is checked before writing: if `FileSystem.getFreeDiskStorageAsync()` returns < 5MB, show toast "Unable to save photo — device storage is full" and abort (returns to camera)

### AC9 — Station disambiguation (post-capture)
**Given** a photo is captured and GPS resolves to TWO OR MORE stations within 200m
**When** the `StationDisambiguationSheet` is shown (after capture, not before)
**Then** a bottom sheet presents up to 3 nearest station names as one-tap buttons: "Which station was this? [Orlen Grodzka] [Circle K Floriańska]"
**And** driver confirms in one tap — the selected station is used as the `preselectedStationId`
**And** if driver dismisses the sheet without selecting, `preselectedStationId` remains null (server-side GPS matching will resolve it)

### AC10 — PriceConfirmationCard
**Given** a compressed photo is ready (and disambiguation resolved if needed)
**When** the confirmation card is shown
**Then** `PriceConfirmationCard` renders:
- **Fuel type chip** — shows current `selectedFuelType` from app state (PB_95 / ON / LPG etc.), tappable to change via inline picker
- **Price field** — empty, numeric input, optional (user can submit without entering a price — server-side OCR fills it); placeholder "Enter price (optional)"
- **Station name** — GPS-matched station name if known, else "Matching station…"; "Wrong station?" text link resets `preselectedStationId` and re-shows disambiguation sheet
- **"Confirm price" CTA** — amber fill (`#f59e0b`), full-width, submits photo + metadata to offline queue (Story 3.2 interface)

### AC11 — Handoff to offline queue
**Given** driver taps "Confirm price" on PriceConfirmationCard
**When** the submission is initiated
**Then** the following data bundle is passed to the Story 3.2 offline queue interface:
```typescript
interface CaptureResult {
  photoUri: string;          // local file URI of compressed JPEG
  fuelType: FuelType;        // selected fuel type
  manualPrice?: number;      // optional manual entry (PLN/l)
  preselectedStationId?: string; // null if GPS match is ambiguous
  gpsLat: number;            // captured at photo time, not persisted to DB
  gpsLng: number;            // captured at photo time, not persisted to DB
  capturedAt: string;        // ISO timestamp
}
```
**And** navigation returns to map — driver sees the map immediately (confirmation screen is Story 3.2)

### AC12 — i18n
**Given** a driver uses any screen in the contribution flow
**When** their selected language is Polish, English, or Ukrainian
**Then** all guidance text, prompts, and buttons are displayed in that language

### AC13 — Error: camera hardware unavailable
**Given** the device camera cannot be opened (hardware error, permission state inconsistency)
**When** the camera screen loads
**Then** a full-screen error state is shown: "Camera unavailable" + "Go back" button — the driver is returned to the map

---

## Out of Scope (Story 3.1)

- SQLite offline queue implementation → **Story 3.2**
- Upload to server, R2 storage, BullMQ job → **Story 3.3**
- OCR price extraction and pre-fill → **Story 3.5**
- `⛽ Log fill-up` functionality (render the button but no-op) → **future story**
- `PriceConfirmationCard` submission streak display ("3-day streak 🔥") → **Story 3.2**
- `PriceSummaryContent` cross-nudge → **Story 3.2**

---

## Technical Architecture

### New Dependencies (add to `apps/mobile/package.json`)

```json
"expo-camera": "~16.x",
"expo-image-manipulator": "~13.x",
"expo-file-system": "~18.x"
```

> **Check latest compatible versions** with `expo@~55.0.8` before pinning. Run `npx expo install expo-camera expo-image-manipulator expo-file-system` from `apps/mobile/`.

### New Files

```
apps/mobile/
├── app/(app)/
│   └── capture.tsx              ← Full-screen camera route (hidden tab, href: null)
├── src/
│   ├── hooks/
│   │   └── useCameraPermission.ts
│   └── components/contribution/
│       ├── MapFABGroup.tsx
│       ├── CameraOverlay.tsx
│       ├── PriceConfirmationCard.tsx
│       ├── LocationRequiredScreen.tsx
│       ├── StationDisambiguationSheet.tsx
│       └── SignUpGateScreen.tsx  ← only if not already exists — check first
```

### Modified Files

```
apps/mobile/
├── app/(app)/_layout.tsx        ← add hidden `capture` route
├── app/(app)/index.tsx          ← import and render <MapFABGroup>
└── src/i18n/locales/
    ├── en.ts                    ← add contribution.* keys
    ├── pl.ts
    └── uk.ts
```

### Navigation Pattern

`capture` is a **hidden tab screen** (same pattern as `feedback`, `alerts` screens). Add to `_layout.tsx`:
```tsx
<Tabs.Screen name="capture" options={{ href: null, headerShown: false }} />
```

Navigate from `MapFABGroup` via `router.push('/(app)/capture')`.

### `useCameraPermission` Hook Pattern

Follow **exactly** the same pattern as `src/hooks/useLocation.ts`:
```typescript
// src/hooks/useCameraPermission.ts
import { Camera } from 'expo-camera';
import { useState, useEffect } from 'react';

export function useCameraPermission() {
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);

  const requestPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setPermissionGranted(status === 'granted');
    return status === 'granted';
  };

  useEffect(() => {
    Camera.getCameraPermissionsAsync().then(({ status }) => {
      setPermissionGranted(status === 'granted');
    });
  }, []);

  return { permissionGranted, requestPermission };
}
```

### `MapFABGroup` Integration with Map Screen

The existing GPS re-centre FAB in `apps/mobile/app/(app)/index.tsx` is at `bottom: 70` (absolute positioned). Place `MapFABGroup` **above** it:

```tsx
// In index.tsx, alongside existing FAB:
<MapFABGroup
  onAddPrice={handleAddPrice}
  onLogFillup={() => {/* no-op placeholder */}}
  isPanning={isMapPanning}  // hook into map pan events
/>
```

For the pan-fade animation: use `Animated.timing` on opacity — same animation pattern as existing overlays in the map screen.

### Nearby Stations for GPS Indicator & Disambiguation

The map screen already uses `useNearbyStations` (`src/hooks/useNearbyStations.ts`). **Do not create a duplicate hook.**

For the GPS station indicator: filter `stations` from `useNearbyStations` to those within 200m of current `location`. Use existing `location` from `useLocation` hook (already present in index.tsx).

For disambiguation: after capture, filter the same `stations` array to ≤200m from `gpsLat`/`gpsLng` at capture time. Distance formula: Haversine (can use a small utility, check if one exists in `src/utils/` before creating).

### Image Compression

```typescript
// In capture screen, after Camera.takePictureAsync()
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

const compressed = await ImageManipulator.manipulateAsync(
  photo.uri,
  [{ resize: { width: 1920 } }],
  { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
);
```

### Blur/Darkness Quality Check

Implement a simple brightness + blur check after compression. Use a small downsampled grayscale sample:

```typescript
// Resize to 64x64 grayscale for analysis
const sample = await ImageManipulator.manipulateAsync(
  compressed.uri,
  [{ resize: { width: 64, height: 64 } }],
  { format: ImageManipulator.SaveFormat.JPEG, compress: 1 }
);
// Read as base64 and calculate mean luminance from byte values
// Darkness threshold: mean < 30 → show dark prompt
// Blur proxy: JPEG byte size of 64x64 sample < 800 bytes → show blur prompt
// (low entropy in JPEG = few high-frequency components = blurry image)
```

> The blur heuristic uses JPEG file size as a proxy for laplacian variance. A sharp 64x64 crop has higher frequency content → larger JPEG. Threshold values (800 bytes, luminance 30) are empirically chosen starting points — adjust in testing.

### `CaptureResult` Interface

Define in `src/types/contribution.ts` (create if doesn't exist):
```typescript
export interface CaptureResult {
  photoUri: string;
  fuelType: FuelType;
  manualPrice?: number;
  preselectedStationId?: string;
  gpsLat: number;
  gpsLng: number;
  capturedAt: string;
}
```

`FuelType` enum should already exist in `@desert/types` — do NOT redefine it.

### Auth Check

Check auth state using existing `useAuth()` hook (or `AuthContext`) before allowing camera flow. Follow the exact pattern used in existing gated flows (e.g. submission history, account screen). Do NOT create a new auth hook.

---

## i18n Keys (add to all 3 locales: en/pl/uk)

Add under a `contribution` namespace:

```typescript
contribution: {
  addPrice: '＋ Add price',         // PL: '＋ Dodaj cenę', UK: '＋ Додати ціну'
  logFillup: '⛽ Log fill-up',      // PL: '⛽ Zapisz tankowanie', UK: '⛽ Записати заправку'
  locationRequired: {
    title: 'Location Required',     // PL: 'Wymagana lokalizacja', UK: 'Необхідна геолокація'
    message: 'Location access is needed to match your photo to a fuel station.',
    cta: 'Go to Settings',          // PL: 'Przejdź do ustawień', UK: 'Перейти до налаштувань'
  },
  cameraPermissionDenied: 'Camera access denied. Please enable it in Settings.',
  goToSettings: 'Go to Settings',
  gpsLocating: 'Matching station…',
  frameHint: 'Point camera at price board',
  cancel: 'Cancel',
  retakePrompt: {
    blurry: 'Photo may be too blurry — retake for better results',
    dark: 'Photo may be too dark — retake for better results',
    retake: 'Retake',
    useAnyway: 'Use anyway',
  },
  disambiguate: {
    title: 'Which station was this?',
  },
  confirmCard: {
    fuelType: 'Fuel type',
    priceLabel: 'Price (PLN/l)',
    pricePlaceholder: 'Enter price (optional)',
    wrongStation: 'Wrong station?',
    matchingStation: 'Matching station…',
    confirm: 'Confirm price',
  },
  storageFull: 'Unable to save photo — device storage is full',
  cameraUnavailable: 'Camera unavailable',
  goBack: 'Go back',
}
```

---

## Testing Requirements

### `useCameraPermission.test.ts`
- Returns `permissionGranted: null` initially
- Returns `true` when `Camera.getCameraPermissionsAsync` returns `granted`
- Returns `false` when denied
- `requestPermission()` calls `Camera.requestCameraPermissionsAsync()`

### `MapFABGroup.test.tsx`
- Renders "+ Add price" and "⛽ Log fill-up" pills
- Calls `onAddPrice` when "+ Add price" is tapped
- `onLogFillup` no-op does not throw
- Applies opacity fade when `isPanning={true}`

### `LocationRequiredScreen.test.tsx`
- Renders title and message text
- "Go to Settings" CTA calls `Linking.openSettings()`

### `CameraOverlay.test.tsx`
- Renders GPS indicator with station name when `nearestStation` provided
- Renders "Matching station…" when `nearestStation` is null
- Calls `onCapture` when capture button pressed
- Calls `onCancel` when cancel button pressed
- Capture button has correct accessibilityLabel

### `StationDisambiguationSheet.test.tsx`
- Renders station names as buttons
- Calls `onSelect(station)` when button tapped
- Calls `onDismiss` when sheet dismissed without selection

### `PriceConfirmationCard.test.tsx`
- Renders fuel type chip with current fuel type
- Renders station name from `station.name`, else "Matching station…"
- Calls `onWrongStation` when "Wrong station?" tapped
- "Confirm price" CTA calls `onConfirm` with `{ fuelType, manualPrice?, preselectedStationId? }`
- Price field is optional — confirm CTA enabled even when price is empty

---

## Dev Guardrails

- **No gallery access** — `expo-image-picker` is NOT used in this story. `expo-camera` only. Do not add `expo-image-picker` to package.json.
- **GPS never stored** — `gpsLat`/`gpsLng` in `CaptureResult` are passed to Story 3.2 for in-flight use only. Never write them to the database (database write is Story 3.3's concern).
- **Fire-and-forget** — Story 3.1 ends at passing `CaptureResult` to the queue interface. Do NOT implement any network call, upload, or API request in this story.
- **Reuse `useNearbyStations`** — do not create a new hook for fetching stations. Filter the existing stations array.
- **Reuse `useLocation`** — do not call `Location.getCurrentPositionAsync()` independently. Use the `location` already provided by the existing `useLocation` hook.
- **Reuse `useAuth`** — do not create a new auth check. Use the existing hook/context.
- **NativeWind classes** — all styling via NativeWind (Tailwind for RN). Do NOT use `StyleSheet.create()` in new components except where NativeWind doesn't support a property (e.g. absolute positioning of native elements).
- **`FuelType` from `@desert/types`** — do not redefine it.
- **`⛽ Log fill-up` pill is a placeholder** — render it with `opacity: 0.5` and `disabled={true}` to visually indicate it's coming soon. Do NOT wire any navigation.
- **Permission check order** — always check location FIRST, then camera. Never open camera without confirmed location permission.
- **`Linking.openSettings()`** — use for both location and camera settings deep-links (same function, opens device app settings page).

---

## Story 3.2 Interface Contract

Story 3.2 will implement the SQLite offline queue. Story 3.1 must call it via this interface:
```typescript
// Story 3.2 will export this — define as a stub for now:
// src/services/submissionQueue.ts (stub)
export async function enqueueSubmission(capture: CaptureResult): Promise<void> {
  // Stub: Story 3.2 implements this
  console.log('[submissionQueue] enqueued:', capture.capturedAt);
}
```

Import and call `enqueueSubmission(captureResult)` from `PriceConfirmationCard` on confirm. This way Story 3.2 can replace the stub implementation without changing the caller.

---

## Change Log

- 2026-04-01: Story created from epic 3.1 ACs + architecture + UX spec
