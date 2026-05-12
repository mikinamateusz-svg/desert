# litro — Logo Hard Specs

The non-verbal stuff. Everything else (tone, direction, references, process) — phone call.

---

## 1. Brand colours — match exactly

The app palette is locked. SVG fills must be the exact hex values below — no "close enough."

| Role | Hex | Notes |
|---|---|---|
| **Brand amber** | `#f59e0b` | Primary brand colour. Hero of every coloured logo rendering. |
| **Brand ink** | `#1a1a1a` | Wordmark default colour, mono renderings, contrast on amber. |
| White | `#ffffff` | Default light background. |
| Light page | `#f4f4f4` | Standard light app surface. |
| Warm cream | `#fdf6ee` | Warm-tinted background — viable for a softer launcher backing. |

---

## 2. Do NOT use these hexes

The app reserves these for in-product price signals (cheapest / most-expensive / no-data). Avoid all of them — including `#f5c542` which sits close to the brand amber but is a cooler gold and would visually muddle the brand:

`#1a9641` · `#66bd63` · `#f5c542` · `#f46d43` · `#d7191c` · `#94a3b8`

---

## 3. Format requirements

- **Vector masters** in SVG (one per asset: mark, mark-monochrome, wordmark, lockup, launcher-icon).
- **Raster renders** in PNG, sRGB colour space, transparent background (except the launcher-icon render which gets its own background per §4).
- SVG hexes must be the exact values from §1 — verbatim, no rounding, no nearby HSL nudges.
- No embedded raster inside the SVGs (no `<image>` tags, no traced bitmaps).

---

## 4. Launcher icon — what to design for

The launcher icon is the square tile the user sees on their phone's home screen / app drawer. The way phones render it varies a lot, and that variation drives the constraints below.

### How phones actually render it

- **iOS** takes the square image and clips the corners with a rounded-rectangle mask. Anything in the outer corners (~10% inset from the edge) is hidden.
- **Android adaptive icons** are messier. Android takes two layers — foreground (the mark) + background (a solid fill or pattern) — and the launcher app applies its own mask. The mask shape varies by manufacturer:
  - **Pixel / stock Android:** rounded rectangle
  - **Samsung One UI:** squircle (superellipse)
  - **OnePlus:** teardrop
  - **Xiaomi / MIUI:** circle
  - …and others.

Net effect: the only region we can guarantee is visible across all phones is the **circle inscribed inside the inner ~80% of the canvas**. Anything outside that circle gets cut on at least one popular launcher.

### What this means for the design

- **Keep the mark inside the inner ~80%** of the square canvas — roughly 10–15% breathing room from every edge. If you can drop a circle through the centre that touches all four edges of the inner 80% box, the mark should fit inside that circle.
- **Don't put critical detail in the corners.** They will be clipped on every iOS and most Android masks.
- **Background must be a solid fill** that fills the full canvas (the mask reveals it on whatever shape the launcher picks). Three variants worth showing in concepts:
  1. **Amber background `#f59e0b`**, mark in ink or cream — bold, instantly brand-coded
  2. **Cream background `#fdf6ee`**, mark in amber + ink accents — soft, approachable
  3. **Ink background `#1a1a1a`**, mark in amber — premium, stands out in a tray of mostly-bright icons
- **Launcher-icon SVG should still be a single full-canvas square** — don't pre-bake the iOS rounded-corner mask or any platform-specific shape. Each platform's build pipeline applies its own mask on top of our square.

If a 1024×1024 launcher render looks fine but the same mark looks broken when previewed inside a circle (e.g., a Figma circle-mask preview), the mark is too close to the edges — pull it inward.

---

## 5. Render-size compliance check

The mark must be recognisable at **16×16** (favicon) without disappearing. If a 16px render looks like a blob, the mark is too detailed — simplify before delivering.
