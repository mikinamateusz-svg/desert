# Story UI-10: Bug Fixes — Password Masking & Loading Drop Shape

## Status
review

## Story

As a **user**,
I want the login screen to clearly mask my password and the loading animation to look like a fuel drop,
So that the app feels polished and my credentials feel secure.

## Bugs

### B1 — Password field shows no masking characters
`secureTextEntry` is set on the password input in `(auth)/login.tsx`, but the input has no explicit
`color` style. On some Android versions and third-party keyboards, the masking characters (●) are
rendered in a colour that is invisible against the white background. The field appears blank.

**Fix:** Add `color: '#000'` (or the design token equivalent) to the `input` style in `login.tsx`.
Applies to `register.tsx` as well — same input style is used there.

### B2 — Loading screen shape is a pill, not a fuel drop
`LoadingScreen.tsx` uses `borderRadius: DROP_WIDTH / 2` (= 36) on all four corners of the
`dropOuter` container, which produces a symmetric capsule/pill shape. A fuel drop should be
rounded at the bottom and taper toward the top.

**Fix:** Replace uniform `borderRadius` with asymmetric corner radii on `dropOuter` and
`dropOutline`:
- `borderBottomLeftRadius: DROP_WIDTH / 2` (36 — full semicircle)
- `borderBottomRightRadius: DROP_WIDTH / 2`
- `borderTopLeftRadius: 12` (tapered top)
- `borderTopRightRadius: 12`

`dropBackground` and `dropFill` are clipped by `dropOuter`'s `overflow: hidden` — no changes
needed there.

## Acceptance Criteria

**AC1 — Password masking visible:**
Given I type a password on the login or register screen,
Then each character is visibly masked (●) against the white input background on Android and iOS.

**AC2 — Drop shape tapered at top:**
Given the app is loading,
When the loading screen is visible,
Then the fuel drop icon has a rounded bottom and a noticeably tapered (less rounded) top —
not a symmetric pill shape.

**AC3 — Fill animation unchanged:**
The amber fill animation rising from the bottom of the drop still works correctly with the
new shape.

## Tasks

- [ ] Task 1: Fix password masking in `login.tsx` and `register.tsx`
  - [ ] Add `color: tokens.brand.ink` to `input` StyleSheet entry in both files

- [ ] Task 2: Fix drop shape in `LoadingScreen.tsx`
  - [ ] Replace `borderRadius: DROP_WIDTH / 2` with asymmetric radii on `dropOuter`
  - [ ] Apply the same asymmetric radii to `dropOutline` so the border matches

## Dev Notes

- `tokens.brand.ink` is the standard body text colour — use it instead of a hardcoded `#000`
- Only `dropOuter` and `dropOutline` need the borderRadius change; `dropFill` and `dropBackground`
  are clipped by `overflow: hidden` on `dropOuter`
- Check `register.tsx` — it likely has the same unstyled `input` as `login.tsx`

## Note on i18n raw keys (account screen)
The account screen showing `account.notSignedIn` / `account.signIn` as raw strings is a Metro
bundler cache issue — the locale files were updated but the bundler served a stale bundle. Not a
code defect. Fix: restart Metro with `npx expo start --clear`.

## File List
- apps/mobile/app/(auth)/login.tsx (modified)
- apps/mobile/app/(auth)/register.tsx (modified)
- apps/mobile/src/components/LoadingScreen.tsx (modified)
