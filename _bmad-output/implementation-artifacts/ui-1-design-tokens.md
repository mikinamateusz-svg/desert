# Story UI-1: Design Tokens — Shared Colour & Spacing System

Status: done

## Story

As a **developer**,
I want all colours, border radii, and surface values defined in a single tokens file,
So that every screen uses identical values and visual drift across the codebase is eliminated.

## Why

All six mobile screens plus the map currently hardcode hex values independently. Many use off-palette
colours (e.g. `#c0392b`, `#27ae60`, `#ccc`, `#444`, `#888`) that contradict the agreed palette.
A shared tokens file makes future visual changes a one-line edit and unblocks stories UI-2 through UI-5.

## Acceptance Criteria

1. **Given** the file `apps/mobile/src/theme/tokens.ts` exists **When** a developer imports `tokens` **Then**
   all colour, surface, and radius constants from the palette spec are available as typed constants.

2. **Given** the tokens file is created **When** the developer searches the codebase for raw hex strings
   in `*.tsx` `StyleSheet` blocks **Then** no hex string is found in any file under `apps/mobile/app/` or
   `apps/mobile/src/components/` — every value is a `tokens.*` reference.

3. **Given** the migration is applied **When** the app is built **Then** visual output is identical to
   pre-migration (no colour changes in this story — this is a pure refactor).

4. **Given** the tokens file **When** TypeScript compiles **Then** zero type errors (`tsc --noEmit` passes).

## Tasks / Subtasks

### Phase 1 — Create tokens file

- [x] **1.1** Create `apps/mobile/src/theme/tokens.ts` with the following exact content:

```ts
/**
 * Design tokens — Litro colour palette (amber accent, light chrome).
 * Derived from litro-colour-palette.html and ux-color-themes.html (Option C selected).
 * Single source of truth: edit here only.
 */
export const tokens = {
  // ── Price spectrum — fixed functional signals, never used for branding ──
  price: {
    // 5-level quintile palette (updated 2026-04-18) — saturated colors for map pin readability.
    // Population: all stations within max(20km, viewport radius) of user GPS.
    // Cluster guard: if price spread < 0.10 PLN, all show mid (amber/gold).
    // Estimated pins use dark grey #6b7280 background + colored border + white text (WCAG AA).
    cheapest:  '#1a9641', // dark green   — quintile 1 (best deal)
    cheap:     '#66bd63', // medium green — quintile 2
    mid:       '#f5c542', // amber/gold   — quintile 3 (average)
    pricey:    '#f46d43', // warm orange  — quintile 4
    expensive: '#d7191c', // dark red     — quintile 5 (most expensive)
    noData:    '#94a3b8', // slate-400    — unverified / estimated
  },

  // ── Brand ───────────────────────────────────────────────────────────────
  brand: {
    ink:    '#1a1a1a', // wordmark, primary text, ink buttons
    accent: '#f59e0b', // amber — CTA, active tab, streak badge
  },

  // ── Neutral ramp ────────────────────────────────────────────────────────
  neutral: {
    n900: '#111111',
    n800: '#1a1a1a',
    n700: '#2a2a2a',
    n500: '#6b7280',
    n400: '#9ca3af',
    n200: '#e5e7eb',
    n100: '#f4f4f4',
    n0:   '#ffffff',
  },

  // ── Semantic surfaces ────────────────────────────────────────────────────
  surface: {
    page:     '#f4f4f4', // screen background (light, non-map screens)
    card:     '#ffffff', // cards, bottom sheets, inputs
    warmPage: '#fdf6ee', // warm-tinted overlay (map loading state)
  },

  // ── Freshness (reported prices only — filled dot ●) ──────────────────
  fresh: {
    recent: '#22c55e', // < 2 days
    stale:  '#f59e0b', // 2–7 days
    old:    '#94a3b8', // > 7 days — "may be outdated"
  },

  // ── Special pin states ───────────────────────────────────────────────────
  pin: {
    best: '#16a34a', // green-600 — best nearby, halo ring effect
  },

  // ── Tab bar (light theme) ────────────────────────────────────────────────
  tabBar: {
    background: '#ffffff',
    border:     '#e5e7eb',
    active:     '#f59e0b',
    inactive:   '#9ca3af',
  },

  // ── Border radius ────────────────────────────────────────────────────────
  radius: {
    sm:   6,
    md:   10,
    lg:   16,
    xl:   20,
    full: 999,
  },
} as const;

// Re-export as named shortcuts for convenience
export const { price, brand, neutral, surface, fresh, pin, tabBar, radius } = tokens;
```

- [x] **1.2** Create `apps/mobile/src/theme/index.ts` that re-exports everything:
```ts
export { tokens, price, brand, neutral, surface, fresh, pin, tabBar, radius } from './tokens';
```

### Phase 2 — Migrate all screens

For each file below, replace every raw hex/number literal inside `StyleSheet.create()` calls
(and any inline `style={{}}` props) with the appropriate token reference. Import from
`'../../src/theme'` (adjust relative depth as needed for each file's location).

- [x] **2.1** `apps/mobile/app/(app)/_layout.tsx`

  | Old value | Token |
  |---|---|
  | `'#1a1a1a'` (tabBarStyle bg) | `tokens.tabBar.background` |
  | `'#2a2a2a'` (tabBarStyle borderTopColor) | `tokens.tabBar.border` |
  | `'#f59e0b'` (tabBarActiveTintColor) | `tokens.tabBar.active` |
  | `'#aaa'` (tabBarInactiveTintColor) | `tokens.tabBar.inactive` |

- [x] **2.2** `apps/mobile/app/(app)/index.tsx` (map screen)

  | Old value | Token |
  |---|---|
  | `'#1a1a1a'` (container bg) | `tokens.neutral.n800` |
  | `'rgba(26,26,26,0.7)'` (loading overlay) | `'rgba(253,246,238,0.90)'` + `tokens.surface.warmPage` note |
  | `'#f59e0b'` (ActivityIndicator) | `tokens.brand.accent` |
  | `'#f9fafb'` (loadingText) | `tokens.neutral.n0` |
  | `'rgba(239,68,68,0.9)'` (errorBanner bg) | keep — this is functional error red |
  | `'rgba(26,26,26,0.9)'` (locationDeniedBanner) | `tokens.neutral.n800` with opacity |
  | `'#d1d5db'` (locationDeniedText) | `tokens.neutral.n200` |
  | `'#f59e0b'` (locationDeniedDismissText) | `tokens.brand.accent` |

  Also update the `CircleLayer` paint:
  | Old value | Token |
  |---|---|
  | `'#94a3b8'` (circleColor) | `tokens.price.noData` |
  | `'#ffffff'` (circleStrokeColor) | `tokens.neutral.n0` |

- [x] **2.3** `apps/mobile/app/(app)/account.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (container bg) | `tokens.surface.page` |
  | `'#333'` (name text) | `tokens.neutral.n800` |
  | `'#ccc'` (langButton borderColor) | `tokens.neutral.n200` |
  | `'#f59e0b'` (langButtonActive borderColor) | `tokens.brand.accent` |
  | `'#fffbeb'` (langButtonActive bg) | `'#fffbeb'` — amber-50, acceptable inline |
  | `'#f59e0b'` (langButtonTextActive) | `tokens.brand.accent` |
  | `'#444'` (langButtonText, buttonText) | `tokens.neutral.n500` |
  | `'#ccc'` (button borderColor) | `tokens.neutral.n200` |
  | `'#c0392b'` (deleteText) | `tokens.price.expensive` |

- [x] **2.4** `apps/mobile/app/(app)/activity.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (list, center bg) | `tokens.surface.page` |
  | `'#e5e5e5'` (row borderBottomColor) | `tokens.neutral.n200` |
  | `'#1a1a1a'` (stationName) | `tokens.brand.ink` |
  | `'#888'` (date, emptySubtitle) | `tokens.neutral.n400` |
  | `'#555'` (prices) | `tokens.neutral.n500` |
  | `'#d97706'` (rejectedBadge) | `tokens.brand.accent` — amber-600 → use accent for consistency |
  | `'#f59e0b'` (ActivityIndicator, retryButton, loadMore) | `tokens.brand.accent` |
  | `'#ef4444'` (errorText) | `tokens.price.expensive` |
  | `'#333'` (emptyTitle) | `tokens.neutral.n800` |

- [x] **2.5** `apps/mobile/app/(app)/alerts.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (container/center bg) | `tokens.surface.page` |
  | `'#f59e0b'` (all amber refs) | `tokens.brand.accent` |
  | `'#1a1a1a'` (text refs) | `tokens.brand.ink` |
  | `'#666'` (deniedBody) | `tokens.neutral.n500` |
  | `'#888'` (repromptDismissText, emptyTitle secondary) | `tokens.neutral.n400` |
  | `'#dc2626'` (saveErrorText) | `tokens.price.expensive` |
  | `'#ef4444'` (errorText) | `tokens.price.expensive` |
  | `'#e5e5e5'` (divider) | `tokens.neutral.n200` |

- [x] **2.6** `apps/mobile/app/(app)/feedback.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (flex/center bg) | `tokens.surface.page` |
  | `'#333'` (label) | `tokens.neutral.n800` |
  | `'#ccc'` (input borderColor, doneButton) | `tokens.neutral.n200` |
  | `'#aaa'` (placeholderTextColor) | `tokens.neutral.n400` |
  | `'#1a1a1a'` (input text) | `tokens.brand.ink` |
  | `'#999'` (charCount) | `tokens.neutral.n400` |
  | `'#ef4444'` (errorText) | `tokens.price.expensive` |
  | `'#f59e0b'` (submitButton, doneButton) | `tokens.brand.accent` |
  | `'#1a1a1a'` (thankYouText) | `tokens.brand.ink` |

- [x] **2.7** `apps/mobile/app/(app)/privacy-settings.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (centered/container bg) | `tokens.surface.page` |
  | `'#fafafa'` (consentCard bg) | `tokens.surface.card` |
  | `'#eee'` (consentCard border) | `tokens.neutral.n200` |
  | `'#111'` (title, consentType) | `tokens.brand.ink` |
  | `'#666'` (consentDate) | `tokens.neutral.n500` |
  | `'#27ae60'` (statusActive) | `tokens.price.cheap` |
  | `'#888'` (statusWithdrawn, warningText) | `tokens.neutral.n400` |
  | `'#c0392b'` (withdrawButtonText, errorText) | `tokens.price.expensive` |
  | `'#ccc'` (retryButton border) | `tokens.neutral.n200` |
  | `'#444'` (retryButtonText) | `tokens.neutral.n500` |
  | No-colour ActivityIndicator → add `color={tokens.brand.accent}` | `tokens.brand.accent` |

- [x] **2.8** `apps/mobile/app/(app)/delete-account.tsx`

  | Old value | Token |
  |---|---|
  | `'#fff'` (container bg) | `tokens.surface.page` |
  | `'#111'` (title, primaryButton bg) | `tokens.brand.ink` |
  | `'#444'` (body, secondaryButtonText) | `tokens.neutral.n500` |
  | `'#888'` (retained) | `tokens.neutral.n400` |
  | `'#ccc'` (secondaryButton border) | `tokens.neutral.n200` |
  | `'#ccc'` (input border) | `tokens.neutral.n200` |
  | `'#c0392b'` (error text) | `tokens.price.expensive` |
  | `'#c0392b'` (deleteButton bg) | `tokens.price.expensive` |
  | `'#e0b0aa'` (deleteButtonDisabled bg) | `'#fca5a5'` (red-300 — palette-adjacent) |

- [x] **2.9** `apps/mobile/src/components/map/MapPin.tsx`

  | Old value | Token |
  |---|---|
  | `'#94a3b8'` (backgroundColor) | `tokens.price.noData` |
  | `'#ffffff'` (borderColor) | `tokens.neutral.n0` |

- [x] **2.10** Check `apps/mobile/src/components/SoftSignUpSheet.tsx` and `SignUpGateSheet.tsx`
  for hardcoded colours and apply tokens using the same mapping pattern above.

### Phase 3 — Verify

- [x] **3.1** Run `tsc --noEmit` from `apps/mobile/` — zero type errors.
- [x] **3.2** Run `grep -rn '"#' apps/mobile/app apps/mobile/src/components` — zero raw hex strings in `(app)` screens and components. Remaining `(auth)` screens and `GoogleSignInButton.tsx` (Google brand blue `#1a73e8`) are outside migration scope.
- [ ] **3.3** Manual smoke: open each screen on device/simulator and confirm no visual regression.

## Definition of Done

- `apps/mobile/src/theme/tokens.ts` and `index.ts` exist and export all tokens
- Zero raw hex strings in `apps/mobile/app/` and `apps/mobile/src/components/` StyleSheet blocks
- `tsc --noEmit` passes
- All existing tests pass (no behaviour change)

## Review Notes (2026-04-04)

No patches. Pure token refactor — no behaviour change. Design token values correct.
