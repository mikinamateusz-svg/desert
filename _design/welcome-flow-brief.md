# litro — Welcome Carousel Design Brief

**For: Claude Design (or any external designer)**
**Pairs with:** `litro-design-system.md` (overall brand + colour palette + iconography conventions). This brief is task-specific; attach both for full context.
**Story reference:** Story 1.14 — Welcome Carousel (`_bmad-output/implementation-artifacts/1-14-welcome-carousel.md`)
**Date:** 2026-05-09

---

## 1. What we're designing

A **5-step welcome carousel** that's the very first thing a new user sees when they open litro. It establishes the four positioning pillars (photo-verified data, predictive price alerts, integrated spend log, zero-effort capture) plus a community contribution invitation. Each card maps to a pillar that distinguishes Litro from existing PL fuel apps (Yanosik, Fuelio, TuTankuj, Paliwko) — every card is outcome-led, mechanism-hidden, and brief.

Cards (one outcome each, no premium framing):
1. **Pillar 1 — Real prices, no fakes** (verified data quality)
2. **Pillar 4 — We know when prices will rise** (predictive price alerts)
3. **Pillar 3 — Track your fuel spending** (personal spend log)
4. **Pillar 2 — Easy to use** (zero-effort, with map-colour orientation folded in)
5. **Community contribution + final CTA** (how the user contributes; alerts unlock revealed in-app at first photo, NOT in carousel)

Format: full-screen modal overlay shown on first launch, before any other UI. Linear forward navigation; users tap "Dalej" to advance and "Zaczynamy" on the final card to enter the app. **A "Pomiń" (skip / browse first) affordance must be present** — passive users who only consume prices (Marek, Zofia journey types) should not be gated behind a contribution narrative.

The carousel is also re-accessible from the Account screen (in a freely-paginated mode).

## 2. Brand quick-anchor

(Full system in `litro-design-system.md` — this section is the minimum a designer needs.)

- **Name:** litro (always lowercase wordmark)
- **Brand colour:** amber **#f59e0b** (locked)
- **Ink:** #1a1a1a
- **Surface:** #ffffff (cards) / #fdf6ee (warm tinted)
- **Tone:** friendly + utilitarian. Tech harnessed for ordinary drivers, not premium / aspirational, not gimmicky / playful.
- **Visual style:** geometric line illustrations preferred over filled glyphs / 3D / skeuomorphic; single accent colour on neutral ground; readable at small sizes (carousel cards display on mobile screens around 360-430px wide).

## 3. Format & layout

**Mobile-first.** Targets: portrait orientation, 360-430px wide (typical Android), 390-430px wide (typical iPhone). Account for status-bar safe-area at the top and home-indicator safe-area at the bottom (iOS).

**Recommended card composition (top to bottom):**

```
┌─────────────────────────────────────┐
│  [safe-area top spacing]            │
│  ●●●○○   ← progress dots (5 total)  │
│                                     │
│         [ Illustration ]            │
│         (~140-180px tall)           │
│                                     │
│         Title                       │
│         (large, bold, centred)      │
│                                     │
│         Body text                   │
│         (medium, regular, centred,  │
│          max ~3 lines on mobile)    │
│                                     │
│         [optional hint/structure]   │
│                                     │
│   ┌──────────┐  ┌─────────────┐    │
│   │  Wstecz  │  │    Dalej    │    │
│   └──────────┘  └─────────────┘    │
│  [safe-area bottom spacing]         │
└─────────────────────────────────────┘
```

- **Progress dots:** 5 dots in a horizontal row at top. Active dot filled (amber); inactive dots muted (neutral grey). 8px diameter, 6px gap.
- **Illustration zone:** 140-180px tall, centred horizontally. White or warm-cream background. The illustration is the visual anchor of each card.
- **Title:** ~22px, weight 700, ink colour, centred. 1-2 lines max.
- **Body:** ~15-16px, weight 400-500, ink-with-some-transparency or `neutral.n700`, centred, line-height 22-24px. 2-4 lines on a normal screen.
- **Buttons:** "Wstecz" left (secondary, ink-on-light), "Dalej" or "Zaczynamy" right (primary, amber filled, white text). Card 1 hides "Wstecz" (no card 0).
- **Modal corners:** 20px (`radius.xl` from the design system).

## 4. Card-by-card visual brief

All copy is **PL canonical** — final translations to EN/UK happen in i18n. Designer should treat the PL copy as the layout reference.

### Card 1 — Pillar 1: Real prices, no fakes

| Field | Value |
|---|---|
| **Title (PL)** | Tankuj taniej. Prawdziwe ceny. |
| **Body (PL)** | Sprawdź, gdzie naprawdę najtaniej. Bez fałszywek, bez zgadywania. |
| **Illustration concept** | Map fragment with a few colour-coded pins (green/red), with a soft check-mark or "verified" mark anchoring one of them. Communicates "real, trustworthy prices". Avoid showing a camera/photo — that's mechanism, not promise. |
| **Mood** | Confident, trustworthy. Sets the trust differentiator on the very first impression. |
| **Buttons** | "Dalej" only (no Wstecz on card 1). "Pomiń" (skip) tertiary action available top-right of every card except Card 5. |

### Card 2 — Pillar 4: Predictive price alerts

| Field | Value |
|---|---|
| **Title (PL)** | Wiemy, kiedy ceny pójdą w górę. |
| **Body (PL)** | Powiadomimy Cię, zanim podrożeje. Zatankuj dziś, oszczędź jutro. |
| **Illustration concept** | A simple bell or notification glyph paired with a subtle upward-trend line or arrow, hinting at "we anticipate price changes." Clean, minimal — no chart noise. **Do NOT show "+30 dni" badge or "premium" framing** — alerts are core, not a tier. |
| **Mood** | Reassuring, proactive — the app has your back. |
| **Buttons** | "Wstecz", "Dalej" |

### Card 3 — Pillar 3: Personal spend log

| Field | Value |
|---|---|
| **Title (PL)** | Zobacz, ile naprawdę wydajesz na paliwo. |
| **Body (PL)** | Każde tankowanie zapisane automatycznie. Spalanie, oszczędności, koszty — wszystko w jednym miejscu. |
| **Illustration concept** | A simple receipt or fillup-card iconography with a subtle savings-up indicator. Could be a small chart-style mini-block showing month-to-month trend. Avoid being too "fintech" — keep it utilitarian. |
| **Mood** | Practical, empowering. Closes the gap with Fuelio for users migrating from a fillup tracker. |
| **Buttons** | "Wstecz", "Dalej" |

### Card 4 — Pillar 2: Easy to use + map-colour orientation folded in

| Field | Value |
|---|---|
| **Title (PL)** | Otwórz. Sprawdź. Oszczędzaj. |
| **Body (PL)** | Zielone = taniej niż średnia. Czerwone = drożej. Znak ~ = cena szacunkowa, dopóki ktoś jej nie zgłosi. |
| **Illustration concept** | Three teardrop pins side-by-side — green, yellow, red — with optional fourth pin in grey-bordered/tilde style with "~" label. Same as the original Card 3 concept; it earns its place on this card by combining the map-colour explainer with the zero-effort framing. |
| **Mood** | Clear, no-fuss. Teaches the colour code AND promises ease in one card. |
| **Buttons** | "Wstecz", "Dalej" |

### Card 5 — Community contribution + final CTA

| Field | Value |
|---|---|
| **Title (PL)** | Pomóż innym kierowcom. |
| **Body (PL)** | Mijasz stację? Zrób zdjęcie tablicy z cenami. Reszta dzieje się sama. Twoje zdjęcia trafiają na mapę i pomagają wszystkim — w tym Tobie. |
| **Illustration concept** | A phone in hand framing a price board, with a soft success indicator. Communicates the contribution moment without showing a complete OCR pipeline. The "i Tobie również" hint plants reciprocation; the alerts unlock is **NOT** explained in this card — it lands as a delight moment in-app at first verified photo. |
| **Mood** | Warm, communal, closing. Frames contribution as helpful and reciprocal — not a price of admission. |
| **Buttons** | "Wstecz", **"Zaczynamy"** (primary CTA, ends the carousel). No "Pomiń" on the final card — at this point the user either commits or has already used the skip on a prior card. |

## 5. Style direction for illustrations

- **Geometric line illustrations** preferred over filled or 3D
- **One accent colour** (amber #f59e0b) on a neutral ground (white or warm cream)
- **Optional secondary tint** of muted amber or warm grey for depth, kept subtle
- **No gradients** beyond very soft tonal shifts
- **No photographic content** anywhere
- **No hyper-stylised abstract blobs** — we want shapes that read as their literal subject (a phone, a pump, a pin) without being photoreal
- **Icon-style consistency:** all 5 illustrations should feel like they came from the same set — same line weight, same level of abstraction, same colour discipline

**Reference anchors for visual style:**
- Stripe's onboarding illustrations (clean line-based, single accent)
- Linear.app's documentation illustrations (geometric, restrained)
- Polish friendly-utility apps like Yanosik (tone-of-voice reference, not visual)

## 6. Deliverables

**For each of the 5 cards:**
- The full card design (illustration + title + body + buttons + dots) as a Figma frame OR a high-fidelity image
- The illustration **alone** as a separate exportable asset (SVG preferred, or PNG @3x at minimum)

**Plus:**
- Style guide for the illustration set (line weight, colour usage, sizing) so future cards (e.g., Story 7's just-in-time helpers) can match
- One alternate variant of card 5 (the contribution invitation) showing a different illustration treatment, in case the photo-of-price-board feels too literal

## 7. What to avoid

- Cars, wheels, road imagery — we're not an automotive brand
- Coins / dollar / percent symbols — drifts toward fintech / discount
- Pump-station-buildings (too literal, hard to render at small sizes)
- 3D rendered or skeuomorphic styles
- Stock illustration styles (the smiling-flat-people-with-laptops aesthetic)
- Anything that visually contradicts the launcher icon (we're working on that separately — for now, illustrations should feel like they could share a style with whatever final logo direction we land on)

## 8. Open questions for the designer

These can be explored across concept rounds:

1. Does the illustration zone fully fill the available width above the title, or sit centred at a smaller size?
2. Should illustrations have any subtle motion / parallax across cards (advance reveals next illustration with a soft transition), or stay fully static?
3. Card 2 (predictive alerts) — bell + trend-line composition vs. a more abstract "anticipation" treatment?
4. Skip ("Pomiń") affordance — top-right text button, or hidden in a "..." menu? Want it discoverable but not competing with the primary CTA.

## 9. Out of scope for this brief

- The actual modal mechanics (z-index, hardware-back handling, AsyncStorage state) — engineering handles all of that.
- The alternate "Account screen re-access" mode — same cards, just freely browseable; no separate visual treatment needed.
- EN / UK translations — designer works from the PL copy.
- Animation specifics — cards static is fine for v1; add motion later if useful.

---

**Designer's job:** ship the 5 card designs + the illustration set + brief style notes. The implementation team takes those assets and assembles the modal in React Native.
