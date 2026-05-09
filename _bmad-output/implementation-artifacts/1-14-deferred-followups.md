# Story 1.14 — Deferred Follow-ups

These items surfaced during the bmad-code-review on **2026-05-09**. Each is either a pre-existing pattern not caused by 1.14, low-priority polish, or a follow-up too big to fold into this story. The 14 inline patches (P1–P14) were applied in the same commit; this document captures everything else.

---

## Deferred items

### T5 — WelcomeCarousel component tests
Spec T5 calls for Jest + React Native Testing Library coverage: renders card 1 by default, "Dalej" advances / "Wstecz" returns, back blocked at card 1, "Zaczynamy" calls `onComplete` + writes the flag, re-access dismissal paths, resume opens at last seen card. RNTL is not set up in the mobile codebase — same gap deferred from 6.10 and 6.11.

**How to apply:** add `@testing-library/react-native` + `react-test-renderer`, expand jest config to scan `*.test.tsx`, write the seven tests. ~2-3h dev including initial setup. Worth doing before launch since the carousel is the FIRST thing users see and a regression is high-blast-radius.

### Re-access tap-outside dismissal (AC7 literal)
Implementation uses `presentationStyle="fullScreen"` for both modes, which blocks iOS swipe-to-dismiss in first-run mode (correct per AC4) but also blocks tap-outside in re-access mode (deviates from AC7 literal). The user has two working dismissal paths in re-access (Zamknij button + Android back); tap-outside is one of three listed in the spec. Spec amended inline (AC7 wording softened) but the cleaner fix is to swap to `overFullScreen` + `transparent` + a Pressable backdrop in re-access mode.

**How to apply:** branch `presentationStyle` on `mode`. ~30 min dev. Not blocking — current UX is functional.

### Status bar global state restoration on Modal unmount
Carousel's `<StatusBar barStyle="dark-content" backgroundColor={tokens.surface.page} />` mutates global system status-bar state. RN's declarative StatusBar is best-effort; if other screens set their own (most app screens do), the value gets overwritten on the next render. Cosmetic on screens with their own StatusBar; could leak on screens that don't.

**How to apply:** wrap in a context-aware StatusBar component, or rely on each screen having its own. Defer; not user-visible at launch.

### A11y — focus trap, live region on card transitions, decorative SVG hiding, large-text scrolling
Several a11y refinements out of scope for this story:
- `accessibilityViewIsModal={true}` on the Modal root for VoiceOver focus trap
- `accessibilityLiveRegion="polite"` on the card content area so screen readers announce "now on card 3 of 5" after Dalej tap
- `accessibilityElementsHidden={true}` on the illustration container (decorative; title+body carry semantic content)
- ScrollView overflow handling at system font scale 200% (a11y large-text mode) — Card 4 "Ty / My" stack may not fit

**How to apply:** rolled up into a focused a11y-hardening pass across all onboarding + sheet UI. Cross-cutting work.

### SVG width responsive handling
All five illustrations have fixed-pt widths (160-220). On iPhone SE 1st-gen (320pt screen, 24pt parent padding), Card 4's 220pt-wide illustration touches the edges. Acceptable at launch demographics; revisit if reports come in.

**How to apply:** swap `width={SIZE}` for `width="100%"` + `viewBox` preservation. Trivial change but requires manual visual verification on small screens.

### Card 3 SvgText `~` glyph rendering on Android
`<SvgText>` font weight/size on Android `react-native-svg` can render inconsistently without an explicit `fontFamily`. The estimate-pin tilde may look slightly off on some Android devices.

**How to apply:** convert the `~` to a `<Path>` shape (it's a single glyph), or set `fontFamily="System"`. Defer — visible only on visual QA across devices.

### Telemetry on AsyncStorage write failures
`welcomeCompleted` and `welcomeLastCard` writes are silent-on-failure. A user whose AsyncStorage is broken will silently re-see the carousel every launch with no diagnostic for ops to debug. No telemetry SDK in the app yet — deferred to Phase 2 analytics work (Story 6.8 / 4.9 family).

**How to apply:** add a `console.warn` for now; replace with telemetry call once the SDK lands.

### Version stamp on completion flag (re-show on content updates)
Single boolean `welcomeCompleted` means once a user finishes, they never see the carousel again — even if we ship new content (new fuel-type cards, feature additions). Out of scope per spec ("Re-show on app version updates: Once completed, never auto-re-show").

**How to apply:** if Phase 2 wants opt-in re-show on content updates, swap to `welcomeCompletedVersion: number` keyed against a `CAROUSEL_VERSION` const.

### Onboarding completion analytics (per-card drop-off, completion rate)
No tracking of how many users reach each card or finish vs abandon. Out of scope per spec ("Carousel completion analytics — Phase 2"). Without analytics, the spec's stated 20-30s reading-time target is unverifiable.

**How to apply:** instrument card transitions + completion event once the analytics SDK lands.

### `WelcomeCarousel.tsx` file size (518 lines)
Mixes carousel logic, card metadata array, two card-specific subviews (`Card3Legend`, `Card4Body`), and ~170 lines of styles. Readable but bordering on too much for one file.

**How to apply:** when next touched, split into `Card3Legend.tsx`, `Card4Body.tsx`, and `welcomeCarousel.styles.ts`. Pure refactor.

### Close-button × glyph font fallback
Re-access close button uses Unicode `×` (U+00D7). On older Android with limited system font fallback, this glyph may render off-centre. Acceptable in practice; an SVG icon would be more predictable.

**How to apply:** swap to an `Ionicons` "close" icon when next touched.

### Card 4 "Ty / My" border-color pairing
`tokens.brand.accent` (amber) for the Ty block, `tokens.price.cheap` (green) for the My block. Subjective design call — green on the system block reads as "good outcome" but mixes functional and brand colors. A designer review pass would settle whether to use brand-accent for both, or two complementary accents.

**How to apply:** designer review when the v2 commissioned illustrations land.

---

## Triage record

This list captures the `defer` and `bad_spec` buckets from the 1-14 bmad-code-review. The `patch` bucket (P1-P14, applied in the same commit):

- **P1** — `restoredRef` gates the persistence effect until the resume read completes; eliminates the mount-race that overwrote saved card position with `'1'`
- **P2** — `completing` state blocks double-tap on Zaczynamy from firing `onComplete` twice
- **P3** — `AsyncStorage.removeItem(WELCOME_LAST_CARD_KEY)` on completion so a future flag-reset resumes from card 1, not card 5
- **P4** — `clampCard()` defensive helper prevents `CARDS[currentCard-1]` undefined-lookup crash on out-of-range inputs
- **P5** — `WELCOME_LAST_CARD_KEY` no longer exported (internal only)
- **P6** — `<Slot />` gated on `welcomeCompleted === true`; map screen no longer mounts behind the carousel, eliminating concurrent location-permission prompts and tile fetches
- **P7** — Account screen's `useEffect` cleanup sets `welcomeOpen=false` on unmount; prevents orphaned re-access modal floating over the next screen
- **P8** — Quote-mark fixes across PL/EN/UK locales (PL `„…”`, EN ASCII `"…"`, UK `«…»`)
- **P9** — Card 5 badge text now reads from i18n (`card5.badge`) instead of hardcoded `"+30"`; localizes to PL/EN/UK
- **P10** — Card 1 illustration adds `litro` wordmark per spec Visual concept
- **P11** — Card 4 metadata `bodyKey: null` instead of dead `bodyTy` reference; explicit null with comment for future maintainers
- **P12** — Card 4 illustration map pin switched from `price.cheap` (green) to `brand.accent` (amber) — single accent color per AC9
- **P13** — Dropped redundant `accessibilityLabel` on the card title; visible `<Text>` already supplies the label
- **P14** — Progress-step a11y label moved from "active dot only" to the row; child dots marked decorative

The `bad_spec` bucket (S1: AC7 "Wstecz on card 1" wording) was applied by amending the spec inline — the wording was ambiguous between "rendered" and "functional"; clarified that the button is rendered in disabled state for visual symmetry. The spec's "tap-outside" dismissal path was also softened to acknowledge the `fullScreen` Modal limitation; deferred for a clean fix per the deferred items above.

The `reject` bucket (~20 items: defensive flag-format checks against our own writer, per-user vs per-device AsyncStorage scoping that contradicts spec AC5, "force-quit at card 5 strands user" claim ignoring that Wstecz still works, mode-switching mid-flow that's structurally impossible, type-imports already passing, cosmetic-styling design-call disagreements, and several dupes across layers) was discarded as noise.
