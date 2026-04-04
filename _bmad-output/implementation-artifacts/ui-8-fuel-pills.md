# Story UI-8: Fuel Type Pills — Centring & Chrome Separation

Status: ready

## Story

As a **driver viewing the map**,
I want the fuel type pills to be visually centred and clearly separated from the top bar chrome,
So that the map UI feels polished and the pill row doesn't feel cramped or awkwardly left-aligned.

## Why

Two layout issues affect the fuel type selector introduced in Story 2.3:

**1. Left-aligned pills.** `fuelSelectorContent` uses `flexDirection: 'row'` and
`paddingHorizontal: 16` but no `justifyContent: 'center'`. On a standard phone width, the five
pills don't fill the screen, so they sit left-aligned with empty space on the right — which looks
unintentional. They should be centred when they fit, and scroll horizontally when they overflow
(narrow devices or very long locale strings).

**2. Insufficient gap from top bar.** The pills are positioned at `top: topBarHeight + 8`.
The top bar has a `paddingBottom: 10` and a drop shadow — the 8px gap is not enough to provide
clear visual breathing room between the chrome and the floating pill row. 16px gives a clear,
intentional separation.

## Acceptance Criteria

1. **Given** the map screen renders on a standard phone width (≥375 pt) **When** all five fuel
   type pills fit without scrolling **Then** the pill row is horizontally centred on screen.

2. **Given** a narrow device or locale string that causes the pills to overflow the screen width
   **When** the pill row renders **Then** pills are scrollable horizontally and start from the
   left edge (centering degrades gracefully to left-aligned scroll).

3. **Given** the fuel selector renders **When** measured **Then** there is at least 16pt of
   vertical space between the bottom edge of the top bar and the top edge of the pill row
   (currently 8pt — increase to 16pt).

4. **Given** a pill is active (selected fuel type) **When** it renders **Then** visual appearance
   (amber background, dark text) is unchanged from Story 2.3.

5. **Given** the pill row **When** it renders over the map **Then** pills remain tappable with
   no hit-testing regression.

6. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

### Phase 1 — Centre the pills

- [ ] **1.1** In `apps/mobile/app/(app)/index.tsx`, update `fuelSelectorContent` in
  `StyleSheet.create`:
  ```ts
  fuelSelectorContent: {
    flexGrow: 1,              // allows justifyContent to work inside ScrollView
    justifyContent: 'center', // centres pills when they fit; scroll handles overflow
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: 'row',
  },
  ```

  > `flexGrow: 1` is required — without it the `ScrollView` content container won't expand
  > to fill the available width and `justifyContent: 'center'` has no effect.

### Phase 2 — Increase chrome separation

- [ ] **2.1** Increase the `top` offset of the fuel selector from `topBarHeight + 8` to
  `topBarHeight + 16`:
  ```tsx
  <View style={[styles.fuelSelector, { top: topBarHeight + 16 }]} pointerEvents="box-none">
  ```

### Phase 3 — Final checks

- [ ] **3.1** `tsc --noEmit` — zero errors.

- [ ] **3.2** Visual smoke test:
  - Pills centred on standard phone (375pt+) ✓
  - Clear gap between top bar shadow and pill row ✓
  - Active pill still shows amber background ✓
  - Tapping pills still switches fuel type ✓
  - Test in EN, PL, UK (PL strings are short — centering most visible there) ✓

## Definition of Done

- Pills are horizontally centred when they fit on screen
- `fuelSelectorContent` has `flexGrow: 1` and `justifyContent: 'center'`
- Chrome gap is 16pt (`topBarHeight + 16`)
- No visual regression on active pill state
- `tsc --noEmit` passes

## Review Notes (2026-04-04)

No new patches. Prior review (2026-03-25) found no issues. Clean.
