---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
inputDocuments: ['prd.md', 'epics.md']
---

# UX Design Specification — desert

**Author:** Mateusz
**Date:** 2026-03-20

---

<!-- UX design content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

### Project Vision

Community-powered mobile app giving Polish drivers real-time crowdsourced fuel prices. The map IS the product — drivers open it to make a decision (which station), not to browse. Every design choice should serve that split-second decision moment.

### Target Users

**Marek (Price Checker):** Daily commuter who opens the app before or during a refuelling stop. Time-pressured, one-handed, wants the answer in 3 seconds. Rarely contributes but benefits daily.

**Kasia (Contributor):** Motivated early adopter who photographs price boards to help the community. At the pump, phone out, wants the submission to take under 30 seconds including confirmation.

Both users are in a car context — phone in one hand, hurried, potentially in motion.

### Scope

This UX specification covers three flows:
1. Main map screen — layout, information hierarchy, fuel type filter
2. Pin design — states, visual language, price/freshness/promotion communication
3. Submission flow — camera capture overlay, confirmation, offline queuing UX

### Key Design Challenges

1. **Map information density:** Colour-coded pins + freshness + promoted + no-data states + fuel type filter on a mobile screen — needs clear visual hierarchy without clutter.
2. **Camera guidance without friction:** The framing overlay must prevent composition failures (which cause OCR misses) without making the capture feel like filling out a form.
3. **At-pump speed:** Every screen in the submission flow must be completable one-handed in under 30 seconds. No unnecessary taps.

### Design Opportunities

1. The map can be the most visually satisfying fuel price map in Poland — clear, fast, decisive. Set a high bar from day one.
2. The submission confirmation is a small delight moment — make it feel good to contribute.
3. Persistent fuel type preference means Marek never has to re-select — the map always shows his fuel on open.

## Core User Experience

### Defining Experience

The product has one job: help drivers decide which station to go to, faster than any alternative.
The map opens on the user's location and fuel type, prices are visible immediately, and the
decision is made in under 3 seconds. Every other feature — contribution, alerts, history —
exists to keep that map accurate and useful.

The core loop is: **find → decide → navigate → arrive.** The "Navigate" action on a station detail screen launches external navigation (Google Maps / Apple Maps) with the station as the destination, completing the loop without requiring the user to copy an address or search manually.

### Platform Strategy

- **Platform:** React Native (Expo) — iOS and Android, touch-first
- **Context of use:** In or near a car. One-handed. Time-pressured. Possibly moving.
- **Offline:** Fully functional on cached data. Submission queue operates silently.
- **No registration wall:** Map and prices visible before sign-up. Account required only at first contribution.
- **Persistent state:** Fuel type filter persists across sessions. GPS is always the starting point.
- **External navigation:** Station detail screen includes a prominent "Navigate" button that deep-links to the system default maps app (Google Maps on Android, Apple Maps on iOS) with the station coordinates as destination. No address copying, no searching — one tap to directions.
- **Arrival detection & contribution prompt:** When the user returns to desert after navigating, the app checks if they are within ~200m of the station they navigated to. If yes, it shows an in-app prompt: "You made it to [Station Name] — want to update prices for other drivers?" *(Decision: foreground proximity check on app return — works with "while using" location permission only, no background/always-on permission required. Simpler onboarding, acceptable UX trade-off.)*

### Effortless Interactions

- **Fuel type:** Selected once, remembered forever. Never ask again.
- **Location:** Always GPS-centred on open. No search bar needed for the core use case.
- **Navigate:** One tap from station detail launches turn-by-turn navigation to that station in the user's default maps app. No address copying, no searching.
- **Camera flow:** One tap to open camera from station detail. No mode selection, no cropping step, no review screen. Tap → capture → confirm → done.
- **Connectivity:** Offline queue is invisible to the user. A subtle non-alarming indicator shows pending submissions; no error dialogs, no manual retry.

### Critical Success Moments

1. **The decision moment (Marek):** Map loads → green pin visible nearby → 20 groszy cheaper than the red station next door. Decided in 3 seconds without tapping anything.
2. **The navigation moment (Marek):** Taps the cheap station → taps "Navigate" → Google Maps opens with route. Zero friction between decision and driving.
3. **The contribution moment (Kasia):** Photo captured → "Prices updated! 3-day streak 🔥" confirmation. Under 10 seconds pump-to-done. Feels good to have helped.
4. **The trust moment (first-time user):** Prices shown with freshness indicator — "Updated 2h ago" vs "~6.40–6.70 PLN (estimated)". Honest about uncertainty from the start.

### Experience Principles

1. **Decision-first:** Every screen answers "where should I go?" within 3 seconds. Information hierarchy always leads with the price.
2. **Complete the loop:** Finding a cheap station is only useful if the driver gets there. Navigation integration closes the gap between discovery and action.
3. **Invisible infrastructure:** GPS matching, OCR, queue processing happen silently. The user never waits for the machine — they get immediate confirmation and the machine catches up.
4. **One-handed always:** Every critical action reachable from thumb zone. No modals requiring two-handed dismissal in the core flows.
5. **Honest uncertainty:** Estimated prices look different from verified ones. Stale data is flagged, not hidden. Trust is built by showing what we don't know, not just what we do.

## Desired Emotional Response

### Primary Emotional Goals

**The smart driver feeling.** Marek opens desert and immediately knows something other drivers on the road don't — where to save 15 groszy per litre. He feels like he has insider knowledge. That's the feeling we're designing for, and it's the one he'll tell a friend about.

**Accomplishment for contributors.** Kasia submits a photo and knows she helped the next driver who pulls into that station. The streak counter and immediate confirmation make that contribution feel like a small, satisfying win — not a chore.

**Earned trust.** The app builds confidence by being honest: "Updated 2h ago" vs "~6.40–6.70 PLN (estimated)." Users who know the app tells them when data is uncertain trust it more when it says data is fresh.

### Emotional Journey Mapping

| Stage | Target emotion | What creates it |
|-------|---------------|-----------------|
| First open | Curiosity → immediate satisfaction | Map loads with real prices, no empty state |
| Spotting a cheap station | "I'm smarter than the average driver" | Green pin clearly visible, price difference obvious |
| Navigating to a station | Confidence | One tap to directions — no friction |
| Submitting a photo | Accomplishment + belonging | Instant confirmation, streak counter, "you helped X drivers" |
| Returning the next day | Habit, not effort | App remembers fuel type, location is instant |
| Data is stale or estimated | Accepted uncertainty, not doubt | Honest labels, not missing data |

### Emotions to Avoid

- **Anxiety:** "Is this price still right?" → Always show data age; never show a price without a freshness indicator
- **Confusion:** "Which fuel type am I looking at?" → Persistent filter, labelled clearly on every pin and detail screen
- **Guilt/friction:** "I should submit but it's too much effort" → Arrival prompt catches drivers at the right moment; one-tap flow removes the effort
- **Distrust:** "This number feels made up" → Estimated ranges labelled honestly, with explanation available on tap

### Design Implications

- **Feeling smart** → Colour coding gives the answer instantly — no mental arithmetic required. The cheapest option is visually obvious.
- **Accomplishment** → Streak counter + "Prices updated!" confirmation after every submission. Never just a spinner.
- **Trust** → Freshness age on every price. "Estimated" range instead of false precision. Clear visual difference between verified and seeded data.
- **Belonging** → Station detail shows "Updated by the community X times this week" — contributors see evidence their effort matters.
- **No guilt** → Arrival prompt meets Marek at the pump. The submission flow is 3 taps. No excuse not to.

### Emotional Design Principles

1. **Make the right answer obvious.** Users shouldn't have to think — the design surfaces the best option clearly.
2. **Celebrate small wins.** Every contribution deserves acknowledgement. Streaks, confirmations, "you helped others" — make contributing feel good.
3. **Honesty builds more trust than false confidence.** Showing uncertainty correctly earns more trust than hiding it.
4. **Remove guilt from contribution.** The app should catch users at the right moment (arrival prompt) and make the action effortless (one-tap camera flow).

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

**Waze** — community map, contribution without friction
- Bottom sheet pin detail (map stays visible behind detail view)
- One-tap contribution with instant confirmation
- Gamification that rewards without annoying

**Google Maps** — map interaction model and navigation handoff
- Seamless navigation deep link (one button, pre-filled destination)
- Pin clustering: grouped at low zoom, individual at high zoom
- Peek/expand bottom sheet: quick answer without full screen change

**GasBuddy** — direct comparable, studied for anti-patterns
- List-first navigation (avoid — map-first is our differentiation)
- Registration wall at first open (avoid — explicitly not doing this)
- Ad-heavy, cluttered UI (avoid — trust and clarity is our positioning)

**Yuka** — camera capture UX model
- Guide frame overlay with manual trigger for complex targets
- Overlay is subtle and informational, not alarming
- Result arrives instantly after capture — no waiting screen

### Transferable UX Patterns

**Navigation:**
- Bottom sheet for station detail (Waze/Google Maps) — keeps map context, swipe up for full detail
- Tab bar with map as the default and always-accessible tab

**Interaction:**
- One-tap camera entry from station detail (Waze contribution model)
- Peek → expand sheet on pin tap (Google Maps)
- Persistent fuel type chip above the map — always visible, one tap to change

**Visual:**
- Pin clustering at low zoom levels (Google Maps)
- Colour spectrum for relative pricing (green → amber → red), not absolute thresholds
- Subtle camera guide frame (Yuka) — rectangle with corner marks, not a full overlay

### Anti-Patterns to Avoid

- **Registration wall at first open** (GasBuddy) — map and prices visible immediately; account required only at first contribution
- **List as primary view** (GasBuddy) — map is always the home screen; list is a secondary sort/filter tool at most
- **Complex contribution form** — no manual fuel type selection before taking a photo; OCR determines fuel types from the image
- **Navigation away from map for simple actions** — pin tap opens a bottom sheet, not a new screen
- **Over-gamification** — streak counter and confirmation are enough; no XP bars, no badges in the main flow

### Design Inspiration Strategy

**Adopt directly:**
- Waze bottom sheet for pin detail
- Google Maps navigation deep link pattern
- Yuka camera guide frame (subtle corner marks)

**Adapt:**
- Waze contribution lightness → apply to photo submission (one entry point, instant confirmation)
- Google Maps pin clustering → apply at voivodeship/city zoom levels

**Deliberately avoid:**
- GasBuddy's list-first and registration-wall patterns
- Any map overlay that competes visually with pin colours (our primary signal)

## Design System Foundation

### Design System Choice

**Mobile:** NativeWind (Tailwind for React Native) + custom components for map-specific UI
**Web/Admin:** Tailwind CSS + shadcn/ui (already specified in architecture)
**Shared:** Design tokens in `packages/config` — colours, spacing, typography defined once

### Rationale

- NativeWind matches the web Tailwind approach — one mental model across the monorepo
- shadcn/ui components are web-only; NativeWind fills the equivalent role on mobile
- Map-specific components (pins, camera overlay, station sheet) have no viable off-the-shelf equivalent — custom is the right call
- Solo developer context: avoid over-engineering the design system; build components as needed, document tokens upfront

### Implementation Approach

| Surface | Styling | Key libraries |
|---------|---------|---------------|
| Mobile screens | NativeWind utility classes | `nativewind`, `expo-font` |
| Map layer | Mapbox SDK custom layers | `@rnmapbox/maps` |
| Station detail sheet | Bottom sheet component | `@gorhom/bottom-sheet` |
| Camera capture | Custom full-screen component | `expo-camera`, `expo-image-manipulator` |
| Web portal | Tailwind + shadcn/ui | Already in architecture |
| Admin dashboard | Tailwind + shadcn/ui | Already in architecture |

### Customization Strategy

**Design tokens (packages/config):**
- **Price colours:** green-500 (#22c55e) → amber-500 (#f59e0b) → red-500 (#ef4444) — relative pricing spectrum
- **Estimated price colour:** slate-400 — visually distinct from verified prices, clearly secondary
- **App chrome:** neutral-900/white base — dark enough to make coloured pins pop without dark mode complexity
- **Typography:** System font stack — no custom fonts for MVP; add brand font in Phase 2 if needed
- **Pin sizes:** Standard 32×32dp, promoted 40×40dp (25% larger per Epic 8 design)

**Custom components to build (in order of implementation):**
1. StationPin — price display, colour state, freshness dot, promoted variant
2. StationDetailSheet — bottom sheet with peek/expand, price rows, Navigate + Submit buttons
3. CameraOverlay — guide frame with corner marks, capture button, GPS indicator
4. FuelTypeChip — persistent filter above map, single-select
5. SubmissionConfirmation — success state with streak counter

## Core Interaction Design

### 2.1 Defining Experience

**desert: "Open the map, spot the green pin, drive there."**

The defining interaction is price discovery through visual comparison — not a list to scroll,
not a search to run. The map loads, the colour-coded pins answer the question, and the driver
makes a decision in under 3 seconds without tapping anything.

The secondary defining experience is frictionless contribution: at the pump, camera open,
photo taken, confirmation received, done in 15 seconds.

### 2.2 User Mental Model

Current behaviour desert replaces:
- **Habit-based fuelling:** Go to the same station every time, no comparison. Default for ~60% of drivers.
- **Manual search:** Google "ceny paliwa" → news article → outdated price → frustration.
- **GasBuddy-style lists:** App that shows a list of stations with prices — requires reading and mental arithmetic to compare. No visual signal.

Desert's mental model shift: the map answers "where should I go?" before the driver asks. The green pin is the answer. No effort required.

Contribution mental model: photographing a price board is already something some drivers do to remember prices. Desert makes that action useful for everyone, with immediate confirmation that it worked.

### 2.3 Success Criteria

**Price discovery success:**
- Map loads within 3 seconds on a standard connection
- Cheapest nearby station is visually obvious without tapping (green pin stands out)
- Driver can go from app open → navigation started in ≤3 taps
- Freshness of data is visible at a glance — driver knows whether to trust the price

**Contribution success:**
- Camera opens within 1 tap from station detail
- Photo capture to confirmation screen: under 5 seconds
- Confirmation is satisfying, not just functional (streak counter, positive message)
- Offline: driver never sees an error — submission queues silently

### 2.4 Pattern Analysis

**Established patterns (adopt directly):**
- Map with pins: universally understood (Google Maps, Waze)
- Bottom sheet for place detail: familiar from Google Maps
- Camera with guide frame: familiar from document scanning apps
- Navigate deep link: expected behaviour in any location app

**Novel combination (our differentiator):**
- Relative price colour coding on a real-time crowdsourced map — GasBuddy doesn't do this visually; Waze doesn't do prices. The combination is new in the Polish market.
- Arrival-triggered contribution prompt — no app currently catches a driver at the exact moment they're at a pump and asks them to update prices.

**User education required:** None for core flow. Colour = price comparison is self-evident. Contribution flow is camera + tap — no instruction needed.

### 2.5 Experience Mechanics

#### Flow 1: Price Discovery → Navigate

| Step | User action | System response |
|------|-------------|-----------------|
| 1. Open app | App opens | Map centres on GPS, shows pins in last-used fuel type (PB95 default) |
| 2. Scan map | Eyes move to green pin | No action needed — colour coding is the answer |
| 3. Tap pin | Tap cheapest station | Bottom sheet peeks up: station name, price, freshness, Navigate + Submit buttons |
| 4. Confirm | Read price + freshness | Sheet shows "PB95 · 6.42 PLN · Updated 2h ago" |
| 5. Navigate | Tap Navigate | Google Maps / Apple Maps opens with station as destination |
| 6. Return | Arrives, opens desert | Proximity check: if within 200m of navigated station → arrival prompt |

#### Flow 2: Price Contribution

| Step | User action | System response |
|------|-------------|-----------------|
| 1. Open station detail | Tap pin or use arrival prompt | Bottom sheet shows station + "Update prices" button |
| 2. Start submission | Tap "Update prices" | GPS confirmed (silent, already active) → camera opens |
| 3. Capture | Point at price board, tap capture | Photo taken → immediate "Sending..." then "Done!" |
| 4. Confirmation | Reads confirmation | "Prices updated! You're on a 3-day streak 🔥" |
| 5. Return | Swipes back or navigates away | Station detail refreshes; pending indicator shows until OCR completes |

## Visual Design Foundation

### Color System

**Brand origin:** Derived from logo concept B — the gauge "o" arc runs green → amber → red, making the price spectrum integral to the brand identity itself.

**Price spectrum** (semantic, fixed across all surfaces):
- `color.price.cheap` — `#22c55e` (green-500) — cheapest nearby
- `color.price.mid` — `#f59e0b` (amber-500) — average price
- `color.price.expensive` — `#ef4444` (red-500) — most expensive nearby
- `color.price.nodata` — `#94a3b8` (slate-400) — no data / old

**Brand:**
- `color.brand.ink` — `#1a1a1a` — wordmark, primary text, nav chrome
- `color.brand.accent` — `#f59e0b` — CTA buttons, streak badge (amber serves dual duty: mid-price pin on map, brand action in UI chrome — separated by context)
- `color.brand.white` — `#ffffff` — light surfaces, cards, pin labels

**Neutrals:** 8-step ramp from `#111111` (dark surfaces) through `#ffffff` (light surfaces)

**Pin states:**
- Standard: 32×32dp solid fill, white price label
- Promoted: 40×40dp solid fill, amber badge top-right
- Best nearby: `#16a34a` (green-600) fill + white ring + green outer ring + glow shadow
- Estimated: `#e5e7eb` grey fill + price-spectrum coloured outline ring + `~` price prefix

**Freshness indicator:** filled dot (●) on reported prices; hollow ring (○) on estimated
- Green dot: < 2 days (fresh)
- Amber dot: 2–7 days (recent)
- Slate dot: > 7 days ("may be outdated")

**Accessibility:** Colour never used as the sole signal — price value always shown in the pin; freshness always accompanied by text label in the detail sheet.

### Typography System

**Strategy:** System font stack for MVP — no custom fonts. Avoids font loading latency in a map-first, speed-critical product. Brand font can be added in Phase 2.

- **Primary stack:** `-apple-system, 'Segoe UI', Arial, sans-serif`
- **Monospace (tokens/code):** `'Courier New', monospace`

**Type scale (mobile, dp):**
- Price on pin: 8dp / 10dp (promoted) — weight 800, white
- Station name: 13dp — weight 700
- Price in sheet: 22dp — weight 900
- Fuel label / freshness: 10–11dp — weight 600 / regular
- Section labels: 10dp — weight 700, all-caps, letter-spacing 2.5px

**Rationale:** Pin prices must be legible at a glance at arm's length in sunlight. The sheet price is the largest text element — the number is the answer.

### Spacing & Layout Foundation

**Base unit:** 4dp — all spacing is a multiple of 4.

**Key spacing values:**
- Component padding: 16dp / 28dp (screen edge)
- Element gap: 8dp / 12dp / 16dp
- Bottom sheet peek height: ~120dp (station name + primary price + actions visible)
- Thumb zone: all critical actions within 72dp of screen bottom on a 390dp-wide phone

**Layout principles:**
1. Map fills the screen — chrome is minimal and overlaid, not stacked
2. Bottom sheet floats over the map, preserving map context behind it
3. Fuel type chip sits above the map as a persistent overlay, never inside a scroll container
4. One-handed reach is non-negotiable: Navigate and Submit buttons always within thumb zone

### Accessibility Considerations

- All price colours (`#22c55e`, `#f59e0b`, `#ef4444`) pass WCAG AA contrast against white pin labels at the sizes used (checked at 8dp bold weight — marginal for amber; compensated by weight 800 and white background)
- Estimated pin: grey fill + coloured outline ensures the "uncertain" state is distinguishable even if colour is not perceived
- Freshness dot always paired with text label ("Updated Xd ago") — dot is a redundant visual cue, not the sole indicator
- Font sizes at or above 11dp throughout (below 11dp only on secondary decorative labels, not actionable content)

## Design Direction Decision

### Design Directions Explored

Six directions were visualised covering the full range of chrome approaches (floating vs. structural), map tone (dark vs. warm light), and brand expression (amber subtle vs. amber bold). Directions A–F explored: dark cockpit (A), light warm card (B), full-bleed glassmorphism (C), structured white header (D), high-contrast dark (E), amber-branded warm (F).

### Chosen Direction

**Direction F — synthesised** with elements borrowed from D and E.

### Design Rationale

- **Warm off-white map** (`#f5f0e8`) provides a calm, legible base that makes green/amber/red pins pop without the harshness of cold light tiles or the heaviness of dark maps
- **Ink header** (`#1a1a1a`) with embedded fuel chips keeps amber reserved purely for action — not structural chrome
- **Amber** (`#f59e0b`) used only on: active fuel chip, Navigate CTA (primary default state), amber-ghost Navigate (secondary post-arrival state)
- **Fuel chips in header** (from D) — clears map real estate immediately below the header; no floating strip competing with pins
- **24dp price in sheet** (from E) — the price is the answer; making it the largest element in the sheet reinforces the decision-first principle

### Button Hierarchy

Four button variants defined:

| Variant | Usage | Style |
|---|---|---|
| **Amber solid** | Navigate (default primary) | `#f59e0b` fill, white text |
| **Green solid** | Update prices (post-arrival primary) | `#22c55e` fill, white text |
| **Green ghost** | Update prices (default secondary) | `#f0fdf4` fill, `#22c55e` text, `#86efac` border |
| **Amber ghost** | Navigate (post-arrival secondary) | `#fffbeb` fill, `#d97706` text, `#fde68a` border |

### CTA Context Logic

The station detail sheet CTAs switch based on arrival context:

- **Default** (pin tapped, no navigation history): Navigate → amber solid (primary), Update prices → green ghost (secondary)
- **Post-arrival** (app foregrounded within 200m of navigated station): Update prices → green solid (primary), Navigate → amber ghost (secondary), arrival banner shown
- **Fallback** (location permission denied or unavailable): Default layout always shown, no switch, no error

### Implementation Approach

- NativeWind utility classes for all screen-level layout
- Custom `StationDetailSheet` component handles both CTA states via a prop (`mode: 'default' | 'arrival'`)
- Arrival detection: foreground proximity check on app resume — `ST_DWithin` 200m, "while using" location permission only
- Map tile provider to match warm `#f5f0e8` base tone (Mapbox style customisation or equivalent)

## User Journey Flows

### Journey 1: Price Discovery → Navigate (Marek)

| Step | User action | System response |
|---|---|---|
| Open app | App opens | Map centres on GPS, PB95 default (or last used fuel type) |
| Scan map | Eyes move to green pin | Colour coding answers the question — no tap needed |
| Tap cheapest pin | Tap | Bottom sheet peeks: station name · price · freshness |
| Confirm | Read price + freshness dot | "PB95 · 6.29 PLN · Updated 1d ago" |
| Navigate | Tap Navigate | External maps app opens with station as destination |
| Return | Opens Litro after arriving | Arrival check: if within 200m → arrival banner + "Add price" CTA |

### Journey 2A: Add Price (Kasia — community contribution)

| Step | User action | System response |
|---|---|---|
| Open camera | Tap "Add price" on map | Camera opens — no station selection required |
| GPS passive | Views overlay | "📍 Orlen Grodzka · 80m" shown passively — informational only |
| Capture | Points at price board, taps capture | Photo pre-processed, queued |
| Sign-up gate | First-time only | "Your photo is ready — sign in to submit it" (Google/Apple/email) |
| Confirmation | Reads confirmation | "Prices updated! 🔥 3-day streak" |
| Cross-nudge | Optional | "Did you fill up? Log pump reading →" |

### Journey 2B: Log Fill-Up (personal + community dual contribution)

| Step | User action | System response |
|---|---|---|
| Open camera | Tap "Log fill-up" on map | Pump display camera opens |
| Capture | Points at pump display, taps capture | OCR extracts cost · litres · price/litre |
| Fuel type | Confirms or corrects fuel type | Dropdown: PB95 / PB98 / ON / LPG |
| Odometer nudge | Sees prompt: "Add odometer for l/100km →" | Can tap or skip |
| Odometer (optional) | Takes odometer photo | OCR extracts km · confirms or corrects |
| Confirmation | Reads confirmation | "47.3L · 314 PLN · PB95 at Orlen updated ✓" |
| Cross-nudge | Optional | "Other fuel prices here may be outdated — Add price →" |

**Note:** pump display price/litre is automatically written as a verified community price for that (station × fuel_type) — the fill-up is simultaneously a personal record and a community contribution.

### Journey 3: First Open & Onboarding

1. App opens → map loads immediately with seeded estimates — no sign-in required
2. Optional sign-up screen shown once: "Track your savings and streak" — Google · Apple · Email · **Skip**
3. GPS permission prompt with value proposition shown before OS dialog
4. If GPS granted: map centres on user's location. If denied: Poland centre, manual pan
5. Fuel type selector shown once: "What do you usually fill up with?" — selection persisted forever
6. Map ready — colour-coded pins visible

**Fuel type is changeable at any time via the header chips — the first-launch prompt sets the default only.**

### Journey 4: Sign-Up at First Contribution

- **Already signed in:** camera opens, photo taken, straight to confirmation
- **Guest user, first contribution:**
  1. Camera opens normally — no interruption
  2. Photo taken and pre-processed, held in local queue
  3. Sign-up gate: "Your photo is ready to submit" + Google · Apple · Email options
  4. Google/Apple: one tap → account created → photo submitted → confirmation
  5. Email: minimal form → account created → photo submitted → confirmation
  6. Abandons: photo discarded, driver returns to map, no nag or penalty

### Journey 5: Ops Photo Review

1. Submission arrives → OCR + GPS matching runs automatically
2. High-confidence result: auto-approved, prices published, no ops action
3. Low-confidence or flagged: enters review queue
4. Ops reviews: original photo + OCR output + matched station
5. Approve → prices published; Correct OCR → re-approve; Reject (bad photo) → driver notified gently
6. Repeated abuse pattern → shadow ban applied silently

### Journey 6: Arrival → Contribution Prompt

Driver returns to app within 200m of navigated station → arrival banner appears above map ("Orlen Grodzka · prices here are 1d old" + inline "Add price" CTA) → tapping opens camera with GPS already resolved → Flow 2A from capture step.

### Journey 7: Station/Chain Manager — Promotion Creation *(Phase 2)*

1. Manager logs into station partner portal
2. Station manager sees their station; chain manager sees all chain stations
3. Creates promotion: headline (e.g. "Orlen card discount") + conditions text (max 120 chars) + fuel type + start/end dates or enable/disable toggle
4. Billing summary shown: estimated cost at agreed rate, billed end of month for days active
5. Submitted for ops text moderation → approved → goes live
6. Promoted pin appears on map (40dp, amber badge, promo indicator); station detail sheet shows promotion section

### Journey 8: Driver — Sees Promotion *(Phase 2)*

1. Spots promoted pin on map — 40dp, amber badge, subtle "promo" tag
2. Taps pin → station detail sheet shows normal price rows unchanged
3. Promotion section below prices: headline + conditions + valid until date
4. Driver decides whether the promotion applies to them — price rows are unmodified

### Phase 2 Journeys *(noted, not yet designed)*

- **Station manager — direct price update:** web portal → enter prices per fuel type → published with `source: manager` badge. Requires ownership verification.
- **Fleet manager — setup & tracking:** web dashboard → add vehicles → invite drivers → per-vehicle consumption, spend vs. regional average auto-populated from mobile.
- **Data buyer — API access:** web portal → register → select dataset → API key issued. Minimal UX surface.

### Journey Patterns

**Pre-gate, then delight:** Map visible immediately. Sign-up offered softly at install, required only at first contribution — at which point the photo is already queued and the driver is invested.

**Confirmation as junction:** Every confirmation celebrates the completed action and offers one optional next step. Never mandatory branching.

**Silent degradation:** GPS denied, offline, ambiguous station — all degrade to a working reduced state. No blocked flows in the critical path.

**Dual contribution:** Pump display photos contribute to both personal records and the community price map. Drivers get personal value; the community benefits without extra effort.

**Promotions never touch reported prices:** Promotional pricing is additive information in the station sheet alongside community-reported prices. Drivers always see both.

### Flow Optimisation Principles

1. **Map loads before anything is asked** — GPS, fuel type, sign-in all come after first value is delivered
2. **Contribution gates appear mid-flow** — driver is committed (photo taken) when sign-up appears; conversion is higher; photo queued visibly reduces abandonment
3. **Every confirmation offers one optional next step** — one clear nudge, not a menu
4. **Ops automation-first** — review queue receives only genuinely ambiguous cases
5. **Fuel type is a default, not a lock** — set once, changed any time via header chips

---

## Component Strategy

### Design System Foundation

**NativeWind (Tailwind for React Native) + custom components** — confirmed in Step 6.

NativeWind provides layout primitives, typography utilities, spacing/border-radius/shadow tokens, color utilities, and basic interactive primitives (Pressable, TextInput). All custom components reference NativeWind config tokens — no hardcoded hex in component files. Token values live in `tailwind.config.js`.

### Design System Coverage

**Available from NativeWind without custom work:**
- Layout: View, ScrollView, FlatList with utility class styling
- Typography: font-size, weight, color, line-height tokens
- Spacing, border-radius, shadow utilities
- Pressable / TouchableOpacity with `active:` state variants
- Basic form inputs (TextInput)

**Not covered — requires custom components:**
- Map pins with state variants (price tier, freshness, estimated, promoted, best nearby)
- Horizontally scrollable fuel type chip bar
- Draggable bottom sheet with collapsed/expanded states
- Camera viewfinder overlay with guide frame
- Floating action button group (stacked dual-pill layout)
- Arrival banner (contextual section within station sheet)
- Price and fill-up confirmation cards
- First-launch onboarding fuel prompt
- Sign-up gate screen with queued photo thumbnail

### Custom Components

#### `MapPin`

**Purpose:** Communicates price tier (colour), data freshness (dot), and special states at a glance on the map.

**Anatomy:**
- 32x32dp circle (40dp for promoted variant)
- Fill: price-tier colour — `#16a34a` cheap / `#f59e0b` mid / `#dc2626` expensive / `#e5e7eb` estimated
- Estimated variant: `#e5e7eb` gray fill + price-spectrum coloured outline ring (2.5px box-shadow)
- Freshness dot: 8dp circle, bottom-right corner; filled = reported (green-500 / amber-500 / slate-400); hollow ring (border `#94a3b8`, transparent fill) = estimated
- Promoted badge: amber pill top-right, 40dp pin size
- Best nearby: `#16a34a` fill + white 3px halo + green 5.5px outer ring

**States:**

| State | Size | Fill | Border/Ring | Extras |
|---|---|---|---|---|
| Standard | 32dp | price colour | none | freshness dot |
| Estimated | 32dp | `#e5e7eb` | 2.5px price colour | hollow ring dot |
| Promoted | 40dp | price colour | none | amber badge |
| Best nearby | 32dp | `#16a34a` | white 3px + green 5.5px | freshness dot |
| Selected | 32dp | price colour | 2px white | scale 1.1, 100ms ease-out |

**Accessibility:** `accessibilityLabel="[Station name], [price] PLN, updated [freshness]"`

**First used in:** Story 2.2

---

#### `FuelChipBar`

**Purpose:** Horizontally scrollable selector for active fuel type. Persists selection across sessions.

**Fuel types (from Story 2.4):** PB 95, PB 98, ON, ON Premium, LPG, AdBlue

Note: Branded premium names (Verva ON, Shell V-Power, Excellium) are stored and displayed under standard grade categories — not separate chip options.

**Anatomy:**
- Horizontally scrollable ScrollView, no visible scroll indicator
- Chip pill: border-radius 99px, 8px vertical / 12px horizontal padding
- Active chip: `background: #f59e0b; color: #1a1a1a; font-weight: 700`
- Inactive chip: `background: #2a2a2a; color: #aaa; font-weight: 500`
- "No data" variant (in-sheet context only): inactive chip with dimmed opacity for unavailable fuel types at that station

**Accessibility:** role="tab", accessibilityState={{ selected }}, label includes fuel type full name

**First used in:** Story 2.4

---

#### `StationSheet`

**Purpose:** Bottom sheet with station detail — selected fuel price, expandable full price list, navigation CTA.

**Anatomy:**
- Drag handle: 4x32dp rounded bar at top
- Station name: font-size 17px, font-weight 700, color `#f9fafb`
- Address subtitle: font-size 13px, color `#9ca3af`

**Collapsed state (default on pin tap):**
- Selected fuel type label + price (large, 24dp, price-tier colour) + freshness dot + "Xd ago"
- "Show all fuels v" expandable row (if other fuels have data)
- Arrival banner (conditional — see ArrivalBanner below)
- Navigate CTA: amber solid full-width (default) / amber ghost (post-arrival)

**Expanded state (tap "Show all fuels" or drag up):**
- All fuel types as rows: label + price + freshness dot + "Xd ago"
- "No data" shown for fuel types with no reported prices at this station
- Promotion block (Phase 2): rendered below price list if active promotion exists
- Navigate CTA sticky at bottom

**Loading state:** Skeleton rows

**No-data state:** "No prices reported yet" + "Add price" text link

**Accessibility:** Sheet backdrop dismisses on tap; drag handle has accessibilityLabel="Drag to expand"

**First used in:** Story 2.5

---

#### `ArrivalBanner`

**Purpose:** Contextual nudge shown within the station sheet when the user returns to the app within 200m of a previously navigated station.

**Trigger:** On app foreground resume — GPS checked; if within 200m of last-navigated station, arrival state activates and the station sheet opens automatically (or remains open if already open).

**Anatomy (section within StationSheet, above price rows):**
- Caption: "Prices last updated [X] ago" (color: `#999`, font-size 12px)
- CTA: "+ Add price" green button (background: `#16a34a`)
- Dismiss icon (x) top-right; dismissed state persists for the remainder of the session — does not reappear for the same station visit

**Edge case:** If the user navigated directly without opening the station sheet first, the sheet opens automatically on return and the arrival banner is shown.

**Accessibility:** Dismiss button accessibilityLabel="Dismiss arrival prompt"

**First used in:** Story 2.5 (AC: sheet auto-opens on return within 200m of last-navigated station)

---

#### `CameraOverlay`

**Purpose:** Full-screen camera viewfinder for price board and pump reading capture.

**Anatomy:**
- Full-screen dark viewfinder
- Guide frame: corner marks only (no full rectangle border) — communicates framing without a rigid crop constraint
- GPS station indicator: top center — "● [Station name] · [Xm]" in small pill; passive display, no tap action
- Capture button: 64dp white circle, centered bottom
- Cancel: top-left text button
- Fuel type hint: top-right chip (editable post-capture, not in viewfinder)
- Locked state on capture: brief flash + spinner overlay while photo queues

**GPS unmatched state:** Indicator shows "● Locating station..." — capture still enabled, station matched post-capture

**Accessibility:** Capture button accessibilityLabel="Take photo", accessibilityRole="button"

**First used in:** Story 3.1

---

#### `PriceConfirmationCard`

**Purpose:** Post-capture review screen — OCR-extracted price displayed for user verification/correction.

**Anatomy:**
- Fuel chip (active type, tappable to change) + price field (editable numeric, pre-filled from OCR)
- Station name (GPS-matched) + "Wrong station?" escape link
- "Confirm price" amber solid CTA
- Cross-nudge (bottom): "Did you fill up here? Log pump reading" (text link, dismissable)
- OCR failure fallback: empty price field + "We couldn't read the price — enter it manually"

**States:** OCR success / OCR failure / Submitting (spinner on CTA) / Submitted (brief success before returning to map)

**First used in:** Story 3.1

---

#### `FillUpConfirmationCard`

**Purpose:** Post-capture confirmation for pump reading — litres bought + total cost, optional odometer.

**Anatomy:**
- Fuel type chip (editable) + litres field + total cost field (all pre-filled from OCR where possible)
- Odometer field + "Skip" link (mid-flow optional step — "Add for l/100km tracking")
- "Save fill-up" amber solid CTA
- Cross-nudge (bottom): "Other fuel prices here may be outdated — Add price" (text link)

**First used in:** Story 5.2

---

#### `MapFABGroup`

**Purpose:** Floating contribution entry buttons on the map. Station-free — GPS matching happens after capture.

**Anatomy:**
- Stacked vertical layout, bottom-right above safe area inset
- Primary pill: "+ Add price" — ink fill `#1a1a1a`, white text, border-radius 99px
- Secondary pill: "⛽ Log fill-up" — white fill, `#e5e7eb` border, `#6b7280` text
- 8dp gap between pills

**States:** Default / Pressed (scale 0.96, 80ms) / Hidden (fades out after 300ms map pan, reappears on pan end)

**First used in:** Story 3.1

---

#### `OnboardingFuelPrompt`

**Purpose:** First-launch modal to set default fuel type preference.

**Anatomy:**
- Bottom modal sheet (not full screen)
- Headline: "What fuel do you use?"
- FuelChipBar in single-select mode (all 6 types)
- "Set as default" amber solid CTA + "Skip for now" text link

**Shown:** Once, at first map load. Skippable — defaults to PB 95 if skipped (per Story 2.4).

**First used in:** Story 2.4

---

#### `SignUpGateScreen`

**Purpose:** Sign-up prompt shown at first contribution attempt, after photo is taken and queued.

**Anatomy:**
- Queued photo thumbnail (top) — visible proof of investment
- Headline: "Your photo is ready to submit"
- Subtext: "Sign in to share it with the community"
- "Sign in with Google" + "Sign in with Apple" CTA buttons
- "Create account with email" secondary option
- Reassurance text: "Your photo will be submitted after sign-in"

**States:** Photo queued / Submitting post-sign-in / Error (sign-in failed, photo still queued)

**First used in:** Story 3.1

---

### Component Implementation Strategy

**Build order principle:** Components are built inline with the first feature story that requires them — no separate component stories. The UX spec is the component contract.

**Token consistency:** All custom components reference NativeWind config tokens. No hardcoded hex in component files.

**Accessibility baseline:** Every interactive component includes accessibilityLabel, accessibilityRole, and accessibilityState. Minimum touch target 44x44dp.

**Animation:** Subtle only. Pin scale on select (100ms ease-out), sheet slide-up (250ms ease), FAB fade on pan (300ms). Use react-native-reanimated for 60fps off JS thread.

### Implementation Roadmap

**Phase 1 — Core MVP:**

| Component | Built in Story |
|---|---|
| MapPin (all states) | 2.2 |
| FuelChipBar + OnboardingFuelPrompt | 2.4 |
| StationSheet (collapsed + expanded) + ArrivalBanner | 2.5 |
| CameraOverlay + PriceConfirmationCard + MapFABGroup + SignUpGateScreen | 3.1 |

**Phase 2 — Supporting:**

| Component | Built in Story |
|---|---|
| FillUpConfirmationCard | 5.2 |
| PromotionBanner (in-sheet display) | Phase 2 promotion epic |
| PromotionFormScreen (station manager creation) | Phase 2 promotion epic |

**Phase 3 — Enhancement:**

| Component | Built in Story |
|---|---|
| OfflineQueueIndicator (subtle pending status) | Phase 3 connectivity epic |
| PriceHistoryChart (station trend sparkline) | Phase 3 analytics |

---

## UX Consistency Patterns

### Button Hierarchy

| Level | Style | When to use |
|---|---|---|
| **Primary** | Amber solid (`#f59e0b`, ink text) | One per screen max — the single most important action (Navigate, Confirm price, Save fill-up) |
| **Primary destructive** | Red solid (`#dc2626`, white text) | Irreversible actions only (Delete account) |
| **Secondary** | Outline (`border: 1.5px #e5e7eb`, `#f9fafb` text) | Supporting action alongside primary (Log fill-up alongside Add price FAB) |
| **Amber secondary** | `#fffbeb` fill, `#d97706` text, `#fde68a` border | Primary-looking but lower priority — Navigate in post-arrival state (available, not the focus) |
| **Text link** | No border, `#f59e0b` text | Escape hatches and optional nudges (Wrong station? / Skip / Show all fuels) |

**Rule:** Never two primary buttons on the same screen. The hierarchy must be instantly readable at a glance.

### Navigation Patterns

**Bottom tab bar (Phase 1, 4 tabs):**

| Tab | Label | Content |
|---|---|---|
| Map | Map | Main price map — default/home tab |
| Activity | Activity | Personal submission history + fill-up log |
| Alerts | Alerts | Price drop / sharp-rise notifications + preferences |
| Account | Account | Profile, settings, consent management, sign out |

Active tab: amber indicator. Inactive: `#aaa`. Tab bar background: ink `#1a1a1a`, top border `#2a2a2a`.

Phase 2: Leaderboard added as 5th tab or surfaced within Activity.

**Back navigation within flows:**
- Overlays (camera, confirmation cards): top-left "Cancel" text button
- Sheets: drag down to dismiss, or backdrop tap
- No hardware back button divergence from system default on Android

**Deep links from external navigation app:**
- App returns to foreground in same state as left — no loading on return
- Arrival detection triggers station sheet automatically if within 200m

### Feedback Patterns

**Submission confirmation:**
- Immediate optimistic confirmation on screen (no waiting for server)
- Brief success toast (3s, auto-dismiss) then return to map
- No modal dialogs — inline state change only

**Submission failure — price contribution:**
- Retry silently up to 3x in background
- If all retries fail: discard silently — no user notification
- Rationale: contribution is best-effort; another driver will update the price; user's personal outcome is unaffected

**Submission failure — fill-up record (pump reading + optional odometer):**
- Fill-up record written to local storage first (source of truth), then synced to server — server sync failure is a sync problem, not a data loss problem
- Retry silently up to 3x in background
- If all retries fail: persistent banner on Activity tab — "Fill-up from [time] couldn't be saved — tap to retry"
- Banner persists until dismissed or retry succeeds; does not auto-dismiss
- If app is closed before retry succeeds: failed record remains in local queue; banner shown on next open
- Rationale: driver's personal expense/consumption record is at stake — they must know if it wasn't persisted
- AC to add to Story 5.2: fill-up record written locally before server sync

**Price freshness feedback:**
- Inline on every price row — freshness dot + "Xd ago" text
- Stale flag surfaces as a muted badge on the map pin, not a notification

**Offline state:**
- Price submissions queue silently
- Map loads from cache; experience looks identical to online
- Station count chip reflects cached data state

**Toast / snackbar:**
- Bottom of screen, above tab bar, auto-dismiss 3s
- Used only for transient confirmations: "Price submitted", "Fill-up saved"
- Never used for errors requiring user action

### Form Patterns

**Numeric fields (price, litres, odometer):**
- Numeric keyboard auto-opens on focus
- Pre-filled from OCR where possible — user confirms, not re-enters
- Inline validation on blur: field border turns red + short message below if out of range
- Ranges: price 2.00–15.00 PLN/L; litres 1–200L; odometer 0–999999 km

**Fuel type selection:** Chip selector (FuelChipBar single-select mode), not a dropdown — never opens a modal.

**Text fields:** Character counter shown at 80% of limit; hard stop at max — no over-limit state.

**Validation timing:** On blur. On submit: re-validate and scroll to first error. No red states before the user has touched the field.

### Modal and Overlay Patterns

**Bottom sheet:**
- Always dismissable by drag or backdrop tap
- Never full-screen — always shows map peek at top (minimum 24dp visible) to maintain map context
- One sheet at a time — opening a new sheet closes the current one

**Full-screen overlay:** Camera only. Always has a visible "Cancel" escape.

**No modal alert dialogs:** All confirmations are inline or sheet-based. Account deletion double-confirmation uses a full-width confirmation sheet, not a floating alert.

### Empty States and Loading States

**Map — station count chip:**
- Subtle chip below header shows: "14 stations in view" (loaded) / "Loading..." (in-progress) / "No stations in this area" (zero results)
- Gives passive confidence that data loaded correctly — absence of pins alone is ambiguous

**Last known location:**
- Last GPS fix stored on-device (AsyncStorage) on every successful GPS read
- On open with no GPS: map centres on stored last-known location; chip shows "Using last known location"
- If no stored location: fall back to Warsaw centre; chip shows "Enable location for nearby prices"
- AC to add to Story 2.2

**Station sheet — price rows loading:** Skeleton rows (matching real row height) while loading — no spinner.

**Station sheet — service unavailable:**
- After 5s timeout with no response: show cached data if available, else show "Couldn't load prices — our service may be unavailable. Tap to retry."
- Wording blames the service (honest), not the station data — preserves trust in community prices

**Station sheet — no data:** "No prices reported yet" + "Add price" text link. Valid state, not an error.

### Error States

| Situation | Pattern |
|---|---|
| GPS unavailable | Map falls back to last-known or Warsaw; station count chip shows context |
| Network unavailable | Map cached and silent; submissions queued; station sheet shows service error after timeout |
| OCR failure | Empty price field + "We couldn't read the price — enter it manually" on confirmation card |
| Service unavailable | "Couldn't load prices — our service may be unavailable. Tap to retry." |
| Fill-up sync failure | Persistent banner on Activity tab — data preserved locally |

**Error hierarchy:** inline field error → toast (transient) → banner (persistent) → screen-level error (entire screen broken only).

### Interaction Micro-patterns

**Touch feedback:** `active:opacity-75` on all tappable elements via NativeWind; FAB pills use scale 0.96 on press.

**Haptics:** Light impact on map pin tap; notification feedback on successful submission (expo-haptics).

**Swipe to dismiss:** Bottom sheets only. No swipe-to-delete or swipe actions on list rows in Phase 1.

**Pull to refresh / long press / swipe actions on rows:** Not used in Phase 1.

---

## Responsive Design & Accessibility

### Responsive Strategy

**Mobile app (primary surface — React Native):**

The app is designed for phones. No tablet-optimised layout planned for Phase 1 — on a tablet the phone layout scales up acceptably for MVP. The map fills the screen at any size.

Key phone-size considerations:
- **Small phones (iPhone SE, 375pt wide):** Fuel chip bar scrollable without clips; station sheet clears tab bar; FAB group sits above tab bar with adequate clearance
- **Large phones (414–430pt wide):** More map visible — good. Sheets and cards have natural width ceiling at device width
- **Safe areas:** All interactive elements respect iOS safe area insets (SafeAreaView) and Android gesture navigation insets. Tab bar and FABs live above these insets

**Web — SSR public map (Phase 1, Story 2.9):**

Read-only price map, no contribution flows. Two breakpoints:
- **Mobile (< 768px):** Full-screen map; fuel type filter bar at top; station card slides up from bottom on pin tap
- **Desktop (≥ 768px):** Map ~70% width; sidebar panel for station detail (no bottom sheet); fuel type filter in sidebar

**Web — ops portal (Phase 1):**

Responsive from 320px up — ops team may review queue and manage submissions from a phone when away from a desk. Same two-breakpoint strategy:
- **Mobile (< 768px):** Single-column review queue; action buttons full-width at bottom; submission detail as full-screen view
- **Desktop (≥ 768px):** Queue list + detail panel side-by-side

**Web — station manager portal (Phase 2):**

Desktop-primary with basic mobile responsiveness for checking stats on the go.

### Breakpoint Strategy

**Mobile app:** No CSS breakpoints — React Native uses Dimensions API and useWindowDimensions hook where layout must adapt. Two cases handled in practice:
- Small phone (width < 390pt): chip bar scroll behaviour, sheet max heights
- Standard phone (width ≥ 390pt): default layout

**Web surfaces:**

| Breakpoint | Range | Layout |
|---|---|---|
| Mobile | < 768px | Single column, bottom sheet / full-screen detail, full-width actions |
| Desktop | ≥ 768px | Map + sidebar panel, standard nav |

No tablet-specific breakpoint — the desktop layout works from 768px upward.

### Accessibility Strategy

**Target compliance: WCAG 2.1 AA** — industry standard and legally required for EU-facing digital services under the European Accessibility Act.

**Key requirements embedded in the design:**

| Requirement | Status |
|---|---|
| Colour contrast ≥ 4.5:1 (normal text) | Verified in Step 8 — all text/background combinations pass |
| Touch targets ≥ 44×44dp | Specified on all interactive components |
| Screen reader labels | accessibilityLabel / accessibilityRole on all components |
| No colour as sole signal | Freshness dot always paired with "Xd ago" text; pin colour always paired with price text |
| Text resize support | NativeWind respects system font scale; layouts tested at 200% |

**Specific accessibility challenges for desert:**

- **Map pins as primary UI:** Pins are visual-only; screen readers cannot read them directly. Mitigation: station sheet (opened by tapping any pin) is fully accessible; VoiceOver/TalkBack users navigate via pin tap → accessible sheet flow
- **Camera overlay:** Screen reader announces "Price board camera — tap to capture"; GPS station indicator text is read aloud; capture button reachable without sight
- **Colour-blind users (Phase 1 fallback):** Price text is always visible alongside pin colour — colour is never the sole signal. *Phase 3 note: consider an alternative price range visualisation mode for colour-blind users (e.g. pattern fill, icon shape, or high-contrast theme). Red-green colour blindness affects ~8% of male users — worth designing a proper solution once core product is stable.*
- **One-handed use:** All primary actions reachable from the bottom 60% of screen; no critical actions in top corners (Cancel/back at top-left is acceptable)

**Language and localisation:**
- English is the base development language — all strings defined in English in code
- Polish is the runtime default for the Polish market; English and Ukrainian are user-selectable
- All strings (including accessibilityLabel values) go through the i18n translation pipeline — the translated string is what VoiceOver/TalkBack speaks to the user

### Testing Strategy

**Device testing (mobile app):**
- iPhone SE (375pt) — small screen edge case
- iPhone 15 (393pt) — current iOS standard
- Pixel 7 (412pt) — Android standard
- Real devices required for GPS and camera flows; simulator not sufficient

**Accessibility testing:**
- VoiceOver (iOS): full navigation of map → pin tap → sheet → Navigate flow, and camera → capture → confirmation flow
- TalkBack (Android): same flows
- Automated: eslint-plugin-jsx-a11y on web surfaces; react-native-accessibility-checker in CI for the app
- Text resize: test at iOS "Larger Accessibility Sizes" (200% font scale) — no layout breaks
- Colour contrast: verified via design tokens before implementation (documented in Step 8)

**Web (SSR public map + ops portal):**
- Cross-browser: Chrome, Safari, Firefox, Edge
- Keyboard navigation: all station interactions reachable by keyboard; map pan/zoom via keyboard controls
- Lighthouse accessibility score target: ≥ 90

### Implementation Guidelines

**React Native:**
- Wrap all screens in SafeAreaView — no manual inset calculation
- accessibilityLabel, accessibilityRole, accessibilityState on every interactive element
- Minimum touch target enforced via `minHeight: 44, minWidth: 44` in component base styles
- Font scaling: allowFontScaling={true} (React Native default) everywhere; test layouts at fontScale 2
- Use sp units (React Native default) for font sizes — not hardcoded pt values

**Design tokens (NativeWind):**
- All colour values from NativeWind config tokens in tailwind.config.js — never hardcoded hex in component files
- Semantic token names used in components (e.g. `bg-amber`, `text-price-cheap`, `bg-ink`) — not raw hex
- Changing a token value in tailwind.config.js propagates to every component that references it — enables central theming, future light mode, or white-label variants without per-component edits
- Example token structure:
  ```js
  colors: {
    ink: '#1a1a1a',
    amber: { DEFAULT: '#f59e0b', secondary: '#fffbeb' },
    price: { cheap: '#16a34a', mid: '#f59e0b', expensive: '#dc2626' },
  }
  ```

**Localisation:**
- All user-visible strings go through the i18n system established in Story 2.3 — including accessibilityLabel values
- English base strings defined in code; translated at runtime based on user language selection
- No strings hardcoded in components outside of i18n keys

**Web:**
- Semantic HTML: nav, main, button, article — not div-only structures
- Visible focus ring on all interactive elements — outline: none only replaced with a visible alternative
- Skip link: "Skip to main content" for keyboard users on public map and ops portal
