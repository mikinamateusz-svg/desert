# Story 2.4: Fuel Type Filtering — Persistence & First-Launch Default

Status: review

## Story

As a **driver**,
I want my selected fuel type to be remembered across sessions,
So that the map always opens on my fuel type without having to reselect it every time.

## Why

Story 2.3 introduced the fuel type selector pills and wired them to price colouring — but
selection is in-memory only (resets to PB 95 on every app restart). The code comment at the
declaration site explicitly marks this as "persistence added in Story 2.4".

The UX specification is unambiguous: *"Selected once, remembered forever. Never ask again."*
A driver who fills with ON should never see PB 95 prices on open.

This story also includes a lightweight first-launch picker: on the very first open (no saved
preference), a bottom-sheet prompt asks "What do you usually fill up with?" so the default is
personalised from the start rather than silently PB 95 for everyone.

## Scope note — AdBlue

The epics spec lists AdBlue as a fuel type. However AdBlue is not in the shared `FuelType` enum
(`packages/types/src/index.ts`) and is not stored in the `price_data` JSONB column. Adding it
requires a coordinated change across types, Prisma schema, backend DTO, and OCR worker — out of
scope here. Deferred to a future story (suggested: 2.7 ORLEN rack ingestion, which extends the
fuel taxonomy).

## Acceptance Criteria

1. **Given** a driver selects a fuel type from the pill bar **When** they close and reopen the
   app **Then** the previously selected fuel type is pre-selected and price colouring reflects it
   immediately — no loading flash to PB 95 first.

2. **Given** a first-time user with no saved preference **When** the map loads for the first time
   **Then** PB 95 is the selected fuel type by default.

3. **Given** a first-time user with no saved preference **When** the splash screen dismisses
   **Then** a bottom-sheet prompt appears: "What do you usually fill up with?" with all five
   fuel type options. Selecting one persists it and dismisses the sheet. Tapping outside the
   sheet (dismiss gesture) persists PB 95 and does not show the prompt again.

4. **Given** the fuel type preference has been set **When** the app is opened on subsequent
   sessions **Then** the first-launch prompt is never shown again.

5. **Given** a driver changes fuel type mid-session via the pill bar **When** they change it
   **Then** the new selection is immediately persisted — no explicit "save" action required.

6. **Given** AsyncStorage read fails on startup (e.g. device storage full) **When** the app
   loads **Then** PB 95 is used as a silent fallback; no crash or error banner.

7. **Given** a stored value that is not a valid `FuelType` (e.g. corrupt or from a future app
   version) **When** the app reads the preference **Then** it falls back to PB 95 and overwrites
   the corrupt value.

8. **Given** the first-launch fuel type picker sheet **When** the user's locale is EN, PL, or UK
   **Then** all labels are translated via the existing `fuelTypes.*` i18n keys.

9. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

10. **Given** Story 2.3 deferred item D4 **When** this story ships **Then** dead legacy i18n
    keys (`petrol_95`, `petrol_98`, `diesel`, `lpg`) are removed from all three locale files,
    as the fuel selector now exclusively uses the canonical keys (`PB_95`, `PB_98`, `ON`,
    `ON_PREMIUM`, `LPG`).

## Tasks / Subtasks

### Phase 1 — Persistence hook

- [x] **1.1** Create `apps/mobile/src/hooks/useFuelTypePreference.ts`:
  ```ts
  import AsyncStorage from '@react-native-async-storage/async-storage';
  import { useState, useEffect, useCallback } from 'react';
  import type { FuelType } from '@desert/types';

  const STORAGE_KEY = '@litro/fuelType';
  const DEFAULT_FUEL: FuelType = 'PB_95';
  const VALID_FUEL_TYPES: FuelType[] = ['PB_95', 'PB_98', 'ON', 'ON_PREMIUM', 'LPG'];

  export function useFuelTypePreference() {
    const [fuelType, setFuelTypeState] = useState<FuelType>(DEFAULT_FUEL);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      AsyncStorage.getItem(STORAGE_KEY)
        .then(value => {
          if (value && (VALID_FUEL_TYPES as string[]).includes(value)) {
            setFuelTypeState(value as FuelType);
          }
          // Invalid or null → silently keep DEFAULT_FUEL (AC6, AC7)
        })
        .catch(() => { /* storage failure → silent fallback */ })
        .finally(() => setLoaded(true));
    }, []);

    const setFuelType = useCallback((ft: FuelType) => {
      setFuelTypeState(ft);
      void AsyncStorage.setItem(STORAGE_KEY, ft).catch(() => { /* silent */ });
    }, []);

    return { fuelType, setFuelType, loaded };
  }
  ```

  > `loaded` flag lets the map screen know when the preference has been read, to avoid the
  > "flash to PB 95 then snap to saved type" visible on first render.

- [x] **1.2** Replace `useState<FuelType>('PB_95')` in `apps/mobile/app/(app)/index.tsx` with
  the hook:
  ```ts
  const { fuelType: selectedFuelType, setFuelType: setSelectedFuelType, loaded: fuelTypeLoaded } = useFuelTypePreference();
  ```
  Remove the now-redundant `// in-memory; persistence added in Story 2.4` comment.

### Phase 2 — First-launch prompt

- [x] **2.1** Track whether the first-launch picker has been shown in AsyncStorage:
  - Key: `@litro/fuelTypePromptSeen`
  - Add a `hasSeenFuelTypePrompt` boolean to `useFuelTypePreference` (read alongside fuelType,
    written once when user makes a selection or dismisses).

- [x] **2.2** Create `apps/mobile/src/components/FuelTypePickerSheet.tsx`:
  - Reuse the `BottomSheet`-style pattern from `SoftSignUpSheet` (no new dependencies).
  - Title: `t('fuelPicker.title')` — "What do you usually fill up with?"
  - Subtitle: `t('fuelPicker.subtitle')` — "You can change this anytime from the map."
  - List all 5 fuel types as large tappable rows with the `fuelTypes.*` label.
  - Tapping a row: calls `setFuelType(ft)`, marks prompt seen, calls `onDismiss`.
  - Dismiss gesture (swipe or backdrop tap): marks prompt seen, persists PB 95 (or whatever
    the current default is), calls `onDismiss`.
  - No "skip" button — dismissing is equivalent to accepting the default.

- [x] **2.3** In `index.tsx`, show `FuelTypePickerSheet` when:
  ```ts
  const showFuelPicker = fuelTypeLoaded && !hasSeenFuelTypePrompt && !splashVisible;
  ```
  Render it after `SoftSignUpSheet` in the JSX (below in the z-stack — only one sheet shows
  at a time since the sign-up sheet takes priority for unauthenticated first-opens).

### Phase 3 — i18n

- [x] **3.1** Add `fuelPicker` namespace to all three locale files:
  ```ts
  fuelPicker: {
    title: 'What do you usually fill up with?',
    subtitle: 'You can change this anytime from the map.',
  },
  ```
  Polish: `title: 'Czym zazwyczaj tankujesz?'`, `subtitle: 'Możesz to zmienić w każdej chwili na mapie.'`
  Ukrainian: `title: 'Яким пальним ви зазвичай заправляєтесь?'`, `subtitle: 'Ви можете змінити це в будь-який час на карті.'`

- [x] **3.2** Remove dead legacy i18n keys from all three locale files (Story 2.3 D4):
  Remove `petrol_95`, `petrol_98`, `diesel`, `lpg` from `fuelTypes` namespace in `en.ts`,
  `pl.ts`, and `uk.ts`. Confirm no other screen references these keys (`grep -rn "petrol_95\|petrol_98\|fuelTypes.diesel\|fuelTypes.lpg" apps/mobile`).

### Phase 4 — Final checks

- [x] **4.1** `tsc --noEmit` — zero errors.

- [x] **4.2** Verify `AsyncStorage` is available — it ships with Expo SDK (`@react-native-async-storage/async-storage` is already a dependency from Stories 1.x). Confirm with `grep "async-storage" apps/mobile/package.json`.

- [ ] **4.3** Device smoke test:
  - First install: prompt appears after splash dismisses, PB 95 pre-highlighted ✓
  - Select ON → map updates → kill app → reopen → ON is selected, no flash ✓
  - Kill app without interacting with prompt → reopens with prompt gone, PB 95 selected ✓
  - Change pill mid-session → kill → reopen → new selection persisted ✓
  - Test EN / PL / UK locale on picker sheet ✓

## Definition of Done

- `useFuelTypePreference` hook reads/writes AsyncStorage with PB_95 default and corrupt-value guard
- `loaded` flag prevents flash-to-default on startup
- First-launch picker sheet appears once, never again after dismissal or selection
- Fuel type selection persists across app restarts
- Dead legacy i18n keys (`petrol_95`, `petrol_98`, `diesel`, `lpg`) removed
- `fuelPicker.*` i18n keys in EN / PL / UK
- `tsc --noEmit` passes
- Device smoke test passes

## Intent Gap — AdBlue

The epics spec includes AdBlue as a filterable fuel type. Currently not in `FuelType` enum.
Adding it requires:
1. `packages/types/src/index.ts` — extend `FuelType`
2. Prisma schema + migration — extend `price_data` JSONB validation
3. Backend DTO + price service
4. OCR worker fuel-type taxonomy

Suggested: handle in Story 2.7 (ORLEN rack price ingestion), which will need to extend the
fuel taxonomy anyway. At that point, add AdBlue to the picker and pills simultaneously.
