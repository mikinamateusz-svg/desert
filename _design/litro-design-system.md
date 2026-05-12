# litro — Design System

**Version:** 1.0 (2026-05-09) — packaged for Claude Design / external designers as a self-contained brief + system reference.

---

## 1. Product

**litro** is a community-powered mobile app for Polish drivers showing real-time fuel prices, sourced from drivers themselves via photos of station price boards. The map IS the product — drivers open it to make a single fast decision: *which station should I drive to?*

**Primary use case:** open app → see colour-coded map → spot the cheapest nearby station → drive there. Three-second decision.

**Secondary:** drivers contribute photos of stations they pass, earning premium price-rise alerts as a reward (30-day rolling window per verified contribution).

---

## 2. Brand essence

| Attribute | Value |
|---|---|
| Name | **litro** (always lowercase wordmark) |
| Origin | A litre of fuel — the unit drivers actually buy and pay attention to |
| Tone | **Friendly + utilitarian.** We harness technology to bring practical benefit to ordinary drivers. Not premium / aspirational. Not playful / gimmicky. Honest, useful, modern. |
| Personality | The trustworthy friend who happens to know fuel prices in your city |
| What we are NOT | A loyalty programme, a discount aggregator, a fintech app, a corporate fuel-card service |

**Voice in copy:**
- Direct. Polish-language canonical, conversational not formal.
- *"Tankujesz? Zrób zdjęcie."* — short, concrete, human.
- Treat the user as a peer, not a customer.

---

## 3. Colour palette

Single source of truth: `apps/mobile/src/theme/tokens.ts`. The values below are extracted from there.

### Brand

| Token | Hex | Use |
|---|---|---|
| `brand.accent` | **#f59e0b** (amber) | **Primary brand colour.** CTAs, active tab, streak badge. The amber is warm, fuel-evocative without being literal, and reads at all sizes. |
| `brand.ink` | #1a1a1a (near-black) | Wordmark, primary text, ink-style buttons |

### Functional / price spectrum (NEVER use for branding — these are price signals only)

| Token | Hex | Meaning |
|---|---|---|
| `price.cheapest` | #1a9641 (dark green) | Cheapest 20% in viewport |
| `price.cheap` | #66bd63 (medium green) | 20-40% |
| `price.mid` | #f5c542 (gold) | Middle 20% |
| `price.pricey` | #f46d43 (warm orange) | 60-80% |
| `price.expensive` | #d7191c (dark red) | Most expensive 20% |
| `price.noData` | #94a3b8 (slate) | No data / estimate fallback |

### Neutral ramp

| Token | Hex |
|---|---|
| `neutral.n900` | #111111 |
| `neutral.n800` | #1a1a1a |
| `neutral.n700` | #2a2a2a |
| `neutral.n500` | #6b7280 |
| `neutral.n400` | #9ca3af |
| `neutral.n200` | #e5e7eb |
| `neutral.n100` | #f4f4f4 |
| `neutral.n0` | #ffffff |

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `surface.page` | #f4f4f4 | Standard light background |
| `surface.card` | #ffffff | Cards, sheets, inputs |
| `surface.warmPage` | #fdf6ee | Warm-tinted overlay (loading states) — also a candidate for logo-on-light backgrounds |

### Freshness signals (filled dot ●)

| Token | Hex | When |
|---|---|---|
| `fresh.recent` | #22c55e | Verified < 2 days |
| `fresh.stale` | #f59e0b | 2–7 days |
| `fresh.old` | #94a3b8 | > 7 days |

---

## 4. Typography

System-default sans-serif on each platform (San Francisco on iOS, Roboto on Android). No custom font shipped at launch.

**Hierarchy in use:**
- 22px / weight 700 — screen titles
- 16-18px / weight 600 — primary CTAs, action labels
- 15px / weight 400-500 — body, list items
- 13px / weight 500 — meta info, secondary labels
- 12px / weight 400 — fine print

Wordmark target style: **lowercase "litro"** — slightly geometric, modern, with subtle character. Avoid trendy 2020s "wavy / variable axis" treatments — we want timeless utilitarian, not dated.

---

## 5. Iconography & visual style

**Pins (the most visible visual element):**
- Teardrop shape, 32-38px, rotated -45° so the sharp corner points down
- Solid fill = verified price (uses one of the 5 price-spectrum colours)
- Grey fill with coloured border = estimated price
- Single grey dot in the corner = stale (rack-event-driven freshness from Story 2.17)

**Existing iconography**: outline-style Ionicons. Stroke-based, 24px standard, no fills unless functional (e.g., active tab gets a filled variant).

**Style direction for new icons / illustrations:**
- Geometric line-style preferred over filled glyphs
- Single accent colour (amber) on a neutral ground
- Avoid soft / 3D / skeuomorphic treatments
- Recognisable at 16-24px (favicon, tab bar) — no fine detail that vanishes

---

## 6. Spacing & radius

| Token | Px | Use |
|---|---|---|
| `radius.sm` | 6 | Inline pills, badges |
| `radius.md` | 10 | Cards, inputs |
| `radius.lg` | 16 | Sheets, prominent surfaces |
| `radius.xl` | 20 | Modal corners |
| `radius.full` | 999 | Pills, capsules |

Spacing — multiples of 4 (Tailwind-style): 4, 8, 12, 16, 24, 32. No half-pixels.

---

## 7. Layout patterns

- **Map screen** is the primary surface — coloured pins at user's location, fuel-type filter pill at the top, contribution FAB at bottom-right, station detail sheet slides up from the bottom on tap.
- **Sheets** prefer slide-up modals over full-page navigation for any contextual action (add price, confirm, etc.).
- **Lists** are simple — left-aligned text, optional right-aligned action label, hairline dividers (`StyleSheet.hairlineWidth`).
- **Empty states** carry honest messaging — never decorative-only.

---

## 8. Logo brief — the immediate task

We need a logo that:

1. **Conveys fuel + savings** — there should be no doubt the app is about fuel and saving money on it.
2. **Reads at every scale** — must be recognisable as a 16×16 favicon all the way up to a 1024×1024 store listing tile.
3. **Works monochrome** — for Android adaptive icons, splash screens, and any single-colour rendering context.
4. **Anchors on the amber #f59e0b** — the locked brand colour, used everywhere the logo appears in coloured form.
5. **Pairs with the lowercase "litro" wordmark** — logo can stand alone (just the mark) and combined (mark + wordmark).

**Directional preferences** (in priority order):

- **Strongest direction: stylised fuel pump or pump-nozzle.** Literal, immediately readable, "fuel app" with no guesswork.
- **Second direction: liquid drop** ("litro" = a litre is a unit of liquid; drop = literal embodiment). Could combine with a pump silhouette.
- **Third direction: pump + map pin** combination — adds the geographic/community angle.
- **Fourth direction: stylised "L" letterform** with a fuel-line accent — most abstract; least preferred.

**What to avoid:**
- Coin / dollar / percent symbols (drifts toward fintech / discount territory)
- Cars / wheels / road imagery (we're not an automotive brand)
- Gas stations or buildings (too literal, hard to render at small sizes)
- Generic gradient blobs (unbranded, looks AI-generated)
- Typography-only logos (wordmark exists but the launcher icon needs a mark)

**Asset deliverables expected:**
- Vector mark (SVG)
- Vector wordmark (SVG)
- Combined lockup (mark + wordmark, horizontal) (SVG)
- Monochrome variant of the mark
- Square launcher-icon composition (mark on a background — solid amber? warm cream? black? — needs exploration)
- Reference renders at: 16×16, 32×32, 48×48, 128×128, 512×512, 1024×1024 (PNG renders from the SVG master)

**Constraints to respect:**
- Mark within the launcher-icon should sit comfortably with ~10-15% breathing room from the edge (iOS clips to a rounded square; Android adaptive icons mask further).
- Lockup must work both in amber-on-white and white-on-amber variants.

---

## 9. Voice & copy patterns (for any text inside the logo lockup or accompanying marketing)

- Lowercase wordmark: **litro** — never "Litro" or "LITRO"
- Tagline candidates (not locked, just direction):
  - *"Ceny paliw od kierowców, dla kierowców."*
  - *"Wiesz, gdzie zatankować taniej."*
  - Avoid corporate-sounding ("Smart fuel solutions for drivers") or aspirational-discount ("Save more on every fill-up")

---

## 10. Reference + inspiration anchors

Logos in adjacent-but-not-competing categories that get the right mix of *trustworthy + practical + modern*:
- **Gett** (ride-hail) — geometric lowercase wordmark, clean, friendly utility
- **Citymapper** (transport) — bold colour, simple icon, immediately readable function
- **Yanosik** (Polish driver community app) — community + utility tone, though visually dated; we want their tone, not their style
- **Revolut** (fintech) — confident sans wordmark; useful as a reference for how a lowercase wordmark commands authority without aggression

**What we are aesthetically aiming for**: the stripped-down confidence of a 2020s European utility app. Not 2010s skeuomorphic. Not 2024s playful "blob with gradient". Geometrically clean, single-colour-anchored, instantly legible.

---

## 11. What's already shipped (don't redesign these)

- The colour palette in section 3 is locked
- The amber brand accent is locked (`#f59e0b`)
- The lowercase "litro" wordmark concept is committed (final typographic treatment is part of the work)
- The pin teardrop shape is shipped — logo should not duplicate this exact shape (avoid visual confusion between launcher icon and on-map pin)

---

## 12. Open questions for the designer / Claude Design

These can be explored in concept rounds:

1. Does the mark stand on its own as a launcher icon, or does it need a backing shape (square / rounded-square / circle) for visual containment?
2. Is the launcher-icon background **amber** (mark in dark/cream) or **dark** (mark in amber) or **light cream** (mark in amber + dark)? Each carries a different emotional read.
3. How literal vs. how abstract — a 100% literal pump nozzle versus a heavily abstracted suggestion?
4. Wordmark weight — regular / medium / semibold? Geometric sans (e.g., Inter Display) or humanist (e.g., Karla, Recoleta lite)?
