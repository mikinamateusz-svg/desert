/**
 * Design tokens — Litro colour palette (amber accent, light chrome).
 * Derived from litro-colour-palette.html and ux-color-themes.html (Option C selected).
 * Single source of truth: edit here only.
 */
export const tokens = {
  // ── Price spectrum — fixed functional signals, never used for branding ──
  price: {
    cheapest:  '#1a9641', // dark green  — quintile 1 (best deal)
    cheap:     '#a6d96a', // light green — quintile 2
    mid:       '#ffffbf', // pale yellow — quintile 3 (average)
    pricey:    '#fdae61', // orange      — quintile 4
    expensive: '#d7191c', // dark red    — quintile 5 (most expensive)
    noData:    '#94a3b8', // slate-400   — no price data
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
