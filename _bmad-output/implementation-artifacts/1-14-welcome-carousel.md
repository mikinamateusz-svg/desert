# Story 1.14: Welcome Carousel — First-Run App Explainer

Status: ready-for-dev

**Trigger:** 2026-05-09 — pre-launch UX design pass. New users opening litro for the first time arrive on a coloured-pin map with no context for what the app does, where prices come from, what role they play, or what they get out of it. Today's flow (Story 1.4 first-open onboarding + soft sign-up card) handles "don't force registration" but does **not** explain the app's value prop, the community model, or the alerts-loop reward. Without a clear introduction, users either bounce ("what is this for?") or use the app passively (drop the contribution flywheel that the data freshness depends on).

This story adds a **5-step welcome carousel** shown on first launch (before the soft sign-up card), explaining what litro is, how prices get there, how to read the map, the user's role, and the reward. Linear progression, not skippable, no force-read timer (users can click through at their pace). Re-accessible from the Account screen.

**Phase:** 1 (pre-launch). **Land after** Stories 6.10 and 2.17, since card 5 references the alerts loop and card 3 references the freshness/estimate visual cues those stories introduce.

**Coupled stories already shipped:**
- 1.4 — First-Open Onboarding & Guest Mode (handles soft sign-up card; this story slots in BEFORE that flow).

**Coupled stories to land before 1.14:**
- 6.10 — Contribution-gated alerts (card 5's "30 dni alertów premium" copy must point at a real shipped feature).
- 2.17 — Dynamic freshness UI (card 3's "~" tilde reference matches the actual rendered UI).
- 6.11 (optional) — Alerts inbox; nice-to-have but card 5 doesn't reference inbox specifically.

**Coupled stories not blocking but adjacent:**
- 2.18 — Community-grid estimates (card 3 mentions estimates without explaining mechanics — won't conflict whether 2.18 has shipped or not).

---

## Story

As a **first-time user opening litro**,
I want a brief introduction that explains what the app is, how the data gets here, what I see, and what's in it for me — without being asked to guess any of it,
so that I leave the intro understanding the app's value, my role, and the contribution-reward loop, instead of bouncing or using the app passively.

### Why

The app's data flywheel depends on driver contributions. Drivers who don't understand they're the data source contribute less. Drivers who don't see the alerts-loop reward have no extrinsic motivation to contribute repeatedly. Drivers who don't understand the colour-pin coding misread the map. All three are first-impression failures that the existing flow leaves unaddressed.

A single 5-step carousel, shown once at first launch, addresses all three:
- **Frame** what the app is (community-driven price map).
- **Explain** where data comes from (driver photos + automatic verification).
- **Teach** how to read what they see (colour code + estimate marker).
- **Ask** for their contribution, framed as identity ("kierowcy jak Ty"), not chore.
- **Reward** with the alerts-loop pitch (30-day premium alerts per verified contribution).

Force-read isn't necessary; the user's stated goal is "spend 20-30s going through it", which natural reading pace + 5 cards delivers without disabling buttons. No skip/dismiss enforces linear progression.

---

## Acceptance Criteria

**AC1 — Carousel shown once on first app launch:**
Given a user has not previously completed the welcome carousel (no `desert:onboarding:welcomeCompleted` flag in AsyncStorage),
When the app finishes its initial loading animation/splash and would otherwise show the map (per Story 1.4),
Then the welcome carousel is rendered as a full-screen modal overlay **before** Story 1.4's soft sign-up card,
And the carousel covers the screen with z-index above all other UI,
And the underlying map is not visible behind the modal.

The carousel is shown to **both guest users and authenticated users** equally — it explains the app's value, not anything auth-gated.

**AC2 — Five-step linear progression:**
Given the carousel is open at card N,
When the user taps "Dalej" (cards 1-4) or **"Zaczynamy"** (card 5),
Then the carousel advances to card N+1 (or closes on card 5),
And no other progression mechanism exists (no auto-advance timer, no swipe-to-skip).

The card structure is the five cards specified in the **Card Content** section below.

**AC3 — Backwards navigation within the carousel allowed:**
Given the user is on card N where N > 1,
When they tap a "Wstecz" button or use the Android hardware back button,
Then the carousel goes to card N-1,
And the back button does not close / dismiss the modal at any card.

iOS has no hardware back button; the on-screen "Wstecz" button is the only path back. Card 1's back button is hidden (no card 0 to go to).

**AC4 — No skip / no tap-outside-to-dismiss:**
Given the carousel modal is open,
When the user taps outside the modal content area, swipes down on iOS (modal-dismiss gesture), or attempts any non-button dismissal,
Then the modal does not close,
And only "Zaczynamy" on card 5 sets the completion flag and closes the modal.

The Android back button on card 1 is a special case: it should **not** close the modal (preventing accidental skipping). Block the back action when at card 1; allow back-to-previous-card on cards 2-5.

**AC5 — Completion flag persists per device:**
Given the user reaches card 5 and taps "Zaczynamy",
When the modal closes,
Then `desert:onboarding:welcomeCompleted = 'true'` is written to AsyncStorage,
And subsequent app launches do not re-trigger the carousel,
And the flag is not cleared by logout (registered users who switch accounts on the same device don't re-see the carousel).

App reinstall (which wipes AsyncStorage) naturally re-triggers the carousel — accepted behaviour.

**AC6 — Resume mid-carousel on force-quit:**
Given the user opens the carousel, advances to card N, then force-quits the app or it crashes before completion,
When the app is reopened,
Then the carousel re-opens at card N (read from a second AsyncStorage key `desert:onboarding:welcomeLastCard`, default 1 when absent),
And no completion flag is set yet (the user still hasn't finished).

Tapping "Dalej" updates the `welcomeLastCard` key on every transition so resume is accurate.

**AC7 — Re-access from Account screen ("Jak działa litro?"):**
Given a user has previously completed the carousel (flag set),
When they open the Account screen,
Then a new line item *"Jak działa litro?"* (PL canonical) appears in the standard list-item style,
And tapping it opens the same carousel component in **freely browseable mode**:
- Linear forward via "Dalej" / "Zaczynamy" still works.
- "Wstecz" is rendered on every card including card 1 (for visual symmetry with cards 2-5), but on card 1 it is a no-op — there's no card 0 to navigate to. The button shows in a disabled state.
- Hardware-back / on-screen "Zamknij" close the modal **without** modifying the completion flag. (Tap-outside is not a working dismissal path because the carousel uses `presentationStyle="fullScreen"` to block iOS swipe-down dismissal in first-run mode; same component is reused for re-access. Two working dismiss paths is sufficient.)
- No "Zaczynamy" treatment on card 5 — instead a "Zamknij" button.

Both modes share the same carousel component; the calling context passes a `mode: 'first-run' | 'reaccess'` prop that toggles the dismissal rules.

**AC8 — Card content matches the agreed copy + visual structure:**
The card titles, body copy, and visual elements match the **Card Content** section below. PL canonical, EN/UK translated and present in the i18n type definitions.

**AC9 — Visual budget — illustrations are inline SVG (v1):**
Given each card needs a visual anchor,
When the cards render,
Then each card's illustration is a small inline SVG element (via `react-native-svg`) implementing simple geometric shapes (circles, rectangles, basic icons), monochrome with one brand-accent colour,
And the illustration does not block reading or compete visually with the title/body,
And the implementation files are structured so a future v2 can swap out the SVGs for commissioned illustrations without changing the component shape (per `project_deferred.md` "App icon / brand visual identity revisit" entry).

**AC10 — Accessibility:**
Given a user with VoiceOver / TalkBack enabled,
When they navigate the carousel,
Then each card has appropriate `accessibilityLabel` on the title, body, and buttons,
And the progress dots have an `accessibilityLabel` reading the current card position (e.g. *"Krok 3 z 5"*),
And button states are reflected (`accessibilityState={{ disabled }}` if any button is conditionally disabled).

**AC11 — Locale (PL canonical, EN+UK present):**
Given the i18n locale is PL, EN, or UK,
When the carousel renders,
Then all titles, body, button labels, and the Account-screen line item *"Jak działa litro?"* render in the active locale,
And missing keys cause CI type-check to fail.

---

## Card Content

### Card 1 — Welcome / Identity

**Visual concept**: app logo/wordmark centered. Background: abstract / generic stylised map illustration (NOT Łódź-specific) — could be an abstract street-grid pattern with 4-5 illustrative coloured pins (green/yellow/red) floating around, or an abstract "compass + direction" composition. The point is to suggest "fuel-price map" without referencing real geography.

**Copy (PL canonical):**
- Title: *"Witaj w litro"*
- Body: *"Mapa cen paliw tworzona przez kierowców — dla kierowców. Pokażemy Ci, jak to działa."*
- Subtle hint at bottom: *"Zajmie to chwilę."*

**Buttons:** "Dalej" (primary, only visible button on card 1).

---

### Card 2 — Where the data comes from

**Visual concept**: stylised phone outline with a camera viewfinder inside, pointing at a fuel-price board (rectangular shape with a few price-style marks). Arrow from photo → cloud → checkmark. Communicates "you snap → we process → it lands".

**Copy:**
- Title: *"Skąd biorą się ceny?"*
- Body: *"Każda cena pochodzi od kierowcy, który zrobił zdjęcie tablicy ze stacji. Sprawdzamy każde zgłoszenie automatycznie."*

**Buttons:** "Wstecz" (secondary), "Dalej" (primary).

---

### Card 3 — How to read the map

**Visual concept**: three teardrop pins side-by-side — green, yellow, red — with quick text labels under each ("Tanio" / "Średnio" / "Drogo"). Optionally a fourth pin in grey-bordered/tilde style with a "~" label below (subtle introduction of the estimate marker).

**Copy:**
- Title: *"Kolory pinezek"*
- Body: *"Zielone = tańsze niż średnia. Czerwone = droższe. Znak '~' przy cenie oznacza, że jest ona szacunkowa — dopóki nikt nie zgłosi tej stacji."*

The estimate **mechanics are NOT explained** (per design discussion — "the less we bother the user with mechanics, the better. it's our know-how"). The tilde is acknowledged so users don't wonder when they see it; the meaning ("szacunkowa") is intuitive enough.

**Buttons:** "Wstecz", "Dalej".

---

### Card 4 — Your role

**Visual concept**: two-section "Ty / My" composition. Left/top: person with a phone, taking a photo of a fuel pump or a price board. Right/bottom: cloud + checkmark + map pin (the system handling the rest). An arrow between them shows the handoff. Visually communicates "your job is small; ours is the rest".

**Copy:**
- Title: *"Tylko zdjęcie — resztą zajmiemy się my"*
- Structured body with a "Ty / My" split (rendered as two visual blocks alongside the illustration):
  - *"**Ty:** zrób zdjęcie cen na stacji."*
  - *"**My:** odczytamy je, sprawdzimy i dodamy do mapy."*
- Closing line: *"Tyle wystarczy. Twój czas to tylko ten jeden snap."*

The "Ty / My" structure addresses the user-feedback gap ("right now, I would be like — I take photo and then what??") by explicitly bounding user effort and reassuring on the system side.

**Buttons:** "Wstecz", "Dalej".

---

### Card 5 — The reward

**Visual concept**: bell icon (matching the same bell that 6.10's alerts surface uses on the map header) with a small "+30 dni" badge floating next to it. Subtle clock or calendar element suggesting the renewal cycle. Use the same accent colour as the rest of the carousel illustrations.

**Copy:**
- Title: *"Co Ci to daje?"*
- Body: *"Każde zweryfikowane zdjęcie aktywuje Ci alerty premium na 30 dni — uprzedzimy Cię, gdy ceny mają wzrosnąć. Każde kolejne zdjęcie przedłuża okno alertów."*

**Buttons:** "Wstecz" (secondary), **"Zaczynamy"** (primary, replaces "Dalej").

---

## Tasks

### Mobile (T1–T5)

**T1 — `WelcomeCarousel` component:**
- New component at `apps/mobile/src/components/onboarding/WelcomeCarousel.tsx`.
- Props: `mode: 'first-run' | 'reaccess'`, `onComplete: () => void`, `onClose?: () => void` (re-access only).
- State: `currentCard: number` (1-5), with persistence to AsyncStorage `desert:onboarding:welcomeLastCard` in first-run mode (no persistence in re-access mode).
- Rendering: full-screen `<Modal>` with the active card, progress dots row at top, button row at bottom. Linear forward / backward navigation per AC2/AC3.
- Card components: 5 children rendered conditionally based on `currentCard`. Each card is a small subcomponent in the same file or a `cards/` subfolder.
- Dismissal rules per `mode`: first-run blocks tap-outside / Android-back-on-card-1 / iOS-modal-swipe-dismiss; re-access allows all of these.

**T2 — Inline SVG illustrations per card (v1):**
- Create 5 SVG components (per-card) under `apps/mobile/src/components/onboarding/illustrations/`. Each is a `react-native-svg` component drawn in code per the **Card Content** "Visual concept" descriptions.
- Style: monochrome line illustrations with one brand-accent colour (e.g. `tokens.brand.accent`). Geometric, simple. Each ~120-160px in display size.
- Comment each SVG with a short note saying "v1 placeholder — designed for swap with v2 commissioned illustrations" (per `project_deferred.md` entry).

**T3 — Wire into app launch flow:**
- Update the app's root layout / first-launch detection logic (likely in `apps/mobile/app/_layout.tsx` or similar) to:
  1. On mount, read `desert:onboarding:welcomeCompleted` from AsyncStorage.
  2. If absent, render `<WelcomeCarousel mode="first-run" onComplete={...} />` ABOVE the rest of the navigation tree.
  3. `onComplete` writes the completion flag and unmounts the carousel, allowing the existing 1.4 flow (soft sign-up card) to take over.
- Persistence of `welcomeLastCard` happens on every card transition for resume-on-force-quit (AC6).

**T4 — Account-screen "Jak działa litro?" entry:**
- Modify the Account screen list to add a new item *"Jak działa litro?"* with the standard line-item style.
- Tap → navigates to (or opens a modal containing) `<WelcomeCarousel mode="reaccess" onClose={handleClose} />`.
- `onClose` simply unmounts the carousel; no flag changes.

**T5 — Tests:**
- `WelcomeCarousel` component tests (Jest + React Native Testing Library):
  - Renders card 1 by default in first-run mode.
  - "Dalej" advances; "Wstecz" returns; back navigation blocked at card 1.
  - "Zaczynamy" on card 5 calls `onComplete` and writes the flag.
  - Re-access mode allows close via Android back / "Zamknij" / tap-outside; first-run mode does not.
  - Resume opens at the last seen card.
- AsyncStorage mock used to simulate first-run vs returning users.

### i18n (T6)

**T6 — Translations + Translations type updates:**
- New keys under an `onboarding.welcome` block in `apps/mobile/src/i18n/locales/{pl,en,uk}.ts`:
  - `card1.title`, `card1.body`, `card1.hint`
  - `card2.title`, `card2.body`
  - `card3.title`, `card3.body` (with the tilde mention; verify special-character handling in i18next)
  - `card4.title`, `card4.bodyTy`, `card4.bodyMy`, `card4.closing`
  - `card5.title`, `card5.body`
  - `buttons.next` ("Dalej"), `buttons.back` ("Wstecz"), `buttons.start` ("Zaczynamy"), `buttons.close` ("Zamknij")
  - `progress.stepN` — accessibility label for progress dots ("Krok {{current}} z {{total}}")
  - `account.howItWorks` — Account screen line item *"Jak działa litro?"* (PL) / *"How litro works"* (EN) / *"Як працює litro"* (UK)
- Type definitions updated.

### Code review (T7)

**T7 — Run `bmad-code-review` after dev complete.** Focus areas:

- **First-run trigger ordering**: confirm 1.14 fires BEFORE 1.4's soft sign-up card. If both trigger conditions match (new user, no completion flag), 1.14 should win the z-order race.
- **AsyncStorage key naming**: confirm `desert:onboarding:welcomeCompleted` and `welcomeLastCard` don't collide with any existing keys (the `desert:onboarding:` namespace is reserved for this story's family).
- **Re-access mode rules**: verify all dismissal paths (tap-outside, hardware-back, "Zamknij") work in re-access mode but are correctly blocked in first-run mode. Edge case: user opens re-access from Account, taps "Zaczynamy" on card 5 — does it set the completion flag (it shouldn't)?
- **SVG performance**: rendering 5 inline SVGs shouldn't tank app launch. Verify each is small (well under 1KB serialized) and lazy-rendered (only the active card's SVG mounts).
- **Hardware back button on Android**: explicit `BackHandler` listener required to intercept and either go-back-card or block. Without intercepting, Android back will dismiss the modal which we don't want in first-run mode.
- **iOS modal swipe-dismiss**: `presentationStyle: "fullScreen"` on `<Modal>` blocks the swipe-to-dismiss gesture. Confirm this is set.
- **Status bar / safe area**: full-screen modals on iOS need explicit `SafeAreaView` to avoid notch overlap.
- **Resume edge case**: if the user completes the carousel, then somehow `welcomeLastCard` is left at 5, and they reopen — does the resume logic re-fire the carousel? It shouldn't (completion flag wins). Verify the read order: completion flag first, then last-card key.
- **Accessibility**: VoiceOver / TalkBack walking the carousel reads sensible content + announces card transitions.

---

## Out of Scope

- **Just-in-time / coach-mark tooltips** on the actual UI (map, camera, activity). Explicitly deferred to a separate Topic 7 follow-up.
- **Force-read timer / disabled-button pacing**. Per design decision 2026-05-09, users can click through at their pace.
- **Custom commissioned illustrations** — v1 ships with inline SVG; v2 commissioned art is logged in `project_deferred.md` "App icon / brand visual identity revisit" as a follow-up design pass.
- **Re-show on app version updates**. Once completed, never auto-re-show. Account-screen re-access is the only re-trigger.
- **A/B testing of carousel content / sequence**. No analytics SDK wired in; future Phase 2 with Story 4.9 analytics could revisit.
- **Carousel completion analytics** (per-card drop-off rates). Same — Phase 2.
- **Multi-step gesture interactions** (swipe between cards). Linear button-driven only. Swipe could be added later if usability testing shows users expect it.
- **Backend persistence of completion** (`User.onboarding_completed_at` column or similar). Mobile-only AsyncStorage flag at launch. If we ever want server-side analytics on onboarding completion, that's a Phase 2 follow-up.

---

## Notes for the implementer

- **The carousel is the FIRST thing a user sees** after splash. Polish this. It carries the entire first-impression weight.
- **Don't be clever with timing / animation**. The cards are linear, the buttons are simple, the illustrations are static. No fancy transitions; the standard `<Modal>` slide-up is enough.
- **Card 5's copy specifically references the alerts loop** — this story must land AFTER 6.10/6.11. If 6.10 is delayed, either delay 1.14 too or revise the copy to anticipate (riskier).
- **Card 3's tilde reference** — the actual UI displays "~" only when 2.17 + 2.18 ship. If they're delayed, card 3's body line about the tilde could be confusing to users who don't see it. Coordinate the launch order: 2.17 + 2.18 + 6.10 → 6.11 → 1.14.
- **No code changes outside the new component + Account-screen wiring + app-root flow**. This is a self-contained UI story.
- **No backend changes. No migration. No new API endpoints.**
- **Reading 1.4 first is helpful** — confirms the "soft sign-up card" surface this story precedes.
- **The `mode` prop pattern keeps the component reusable** for re-access. Don't fork into two separate components.
- **AsyncStorage write failures should not crash the app** — wrap in try/catch + log. If we can't write the completion flag, the user re-sees the carousel next launch, which is a recoverable degradation.
