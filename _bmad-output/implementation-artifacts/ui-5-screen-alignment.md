# Story UI-5: Remaining Screens — Visual Alignment

Status: review

## Story

As a **driver**,
I want Activity, Alerts, Feedback, Privacy Settings, and Delete Account screens to feel visually
consistent with the rest of the app,
So that every screen in the app shares the same background, typography, and component language.

## Why

After UI-1 applies token values and UI-2/UI-3/UI-4 establish the Account and Map patterns, a gap
remains: Activity, Alerts, Feedback, Privacy Settings, and Delete Account all use `#fff` white
backgrounds and lack the shared `tokens.surface.page` warm-grey treatment, consistent screen
layout patterns, or the header styles introduced by UI-2.

UI-1 migrates the colour *values* to tokens; this story applies the remaining *structural* visual
patterns (background, safe area, layout, card styling) to close the gap.

## Acceptance Criteria

1. **Given** Activity, Alerts, Feedback, Privacy Settings, or Delete Account screens **When** any
   of them renders **Then** the page background is `tokens.surface.page` (`#f4f4f4`), not white.

2. **Given** the Activity screen **When** rendered **Then** submission rows sit on white card rows
   (`tokens.surface.card`) against the `#f4f4f4` background — giving a list-on-surface feel rather
   than a flat white list.

3. **Given** the Alerts screen **When** the toggle section renders **Then** toggles are presented
   inside a white card (`tokens.surface.card`) with `borderRadius: tokens.radius.lg` and a
   `tokens.neutral.n200` border, not as bare rows directly on a white background.

4. **Given** the Feedback screen **When** rendered **Then** the `TextInput` has `borderColor:
   tokens.neutral.n200` and `backgroundColor: tokens.surface.card`; the surrounding form sits on
   the `tokens.surface.page` background.

5. **Given** the Privacy Settings screen **When** rendered **Then** consent cards use
   `backgroundColor: tokens.surface.card`, `borderColor: tokens.neutral.n200`, and
   `borderRadius: tokens.radius.md`.

6. **Given** the Delete Account screen **When** rendered **Then** both steps use
   `tokens.surface.page` as background; the `TextInput` uses `tokens.neutral.n200` border
   and `tokens.surface.card` background.

7. **Given** all screens after this story **When** a developer runs `grep -rn '"#' apps/mobile/app`
   **Then** the only remaining raw hex literals are inside i18n files and comments.
   (UI-1 handles values; this story handles structural background/card patterns that may have been
   missed or left as `surface.page` placeholders.)

8. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

**Prerequisite:** UI-1 complete (all raw hex values migrated to tokens). UI-2 complete (sub-screen
headers handled by layout — Privacy Settings, Delete Account, Feedback all have native back buttons).

### Phase 1 — Activity screen (`activity.tsx`)

- [ ] **1.1** Change `list` and `center` styles to use `tokens.surface.page` background.

- [ ] **1.2** Wrap the `FlatList` in a `View` with `flex: 1` and `backgroundColor: tokens.surface.page`.
  The list content (rows) should retain `backgroundColor: tokens.surface.card` on each row with
  a `marginHorizontal: 0` and the existing bottom border. This creates a list-on-background effect.

- [ ] **1.3** Update `row` style:
```ts
row: {
  paddingHorizontal: 16,
  paddingVertical: 12,
  backgroundColor: tokens.surface.card,      // white row on grey background
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: tokens.neutral.n200,
},
```

- [ ] **1.4** The empty state and loading/error states use `backgroundColor: tokens.surface.page`
  (already set via UI-1; confirm here).

### Phase 2 — Alerts screen (`alerts.tsx`)

- [ ] **2.1** Change all `container` and `center` styles to `backgroundColor: tokens.surface.page`.

- [ ] **2.2** Wrap the three toggle rows in a white card:
```tsx
<View style={styles.toggleCard}>
  <View style={styles.toggleRow}>...</View>
  <View style={styles.divider} />
  <View style={styles.toggleRow}>...</View>
  <View style={styles.divider} />
  <View style={styles.toggleRow}>...</View>
</View>
```

- [ ] **2.3** Add `toggleCard` style:
```ts
toggleCard: {
  margin: 16,
  backgroundColor: tokens.surface.card,
  borderRadius: tokens.radius.lg,
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  overflow: 'hidden',
},
```

- [ ] **2.4** The value-prop screen (`permissionStatus === 'undetermined'`) and denied screen
  already use `center` style — confirm background is `tokens.surface.page` after UI-1.

- [ ] **2.5** The `repromptBanner` uses `#fffbeb` / `#fde68a` — these are amber-50 / amber-200,
  acceptable inline values for a contextual banner. Leave as-is (do not force to token).

### Phase 3 — Feedback screen (`feedback.tsx`)

- [ ] **3.1** Change `flex` (root container) and `center` style backgrounds to `tokens.surface.page`.

- [ ] **3.2** Update the `ScrollView` content container (`container` style):
```ts
container: {
  padding: 24,
  backgroundColor: tokens.surface.page,
},
```

- [ ] **3.3** Update `input` style to add card background:
```ts
input: {
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  borderRadius: tokens.radius.md,
  padding: 12,
  fontSize: 15,
  color: tokens.brand.ink,
  backgroundColor: tokens.surface.card,
  minHeight: 140,
  marginBottom: 8,
},
```

- [ ] **3.4** The `label` style and `charCount` are already token-aligned from UI-1; confirm.

### Phase 4 — Privacy Settings screen (`privacy-settings.tsx`)

- [ ] **4.1** Change all container/centered backgrounds to `tokens.surface.page`.

- [ ] **4.2** Remove the inline `title` style (large bold title at top of scroll) — this heading
  is now redundant since the screen header from UI-2 already shows "Privacy Settings" in the
  native navigation header. Replace with a `marginBottom: 8` spacer at top of content.

  **Decision note:** If the screen title renders well with the native header, remove `styles.title`
  and the `<Text style={styles.title}>` element. If native header is not showing (edge case),
  keep it as a fallback. Check on device.

- [ ] **4.3** Update `consentCard`:
```ts
consentCard: {
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  borderRadius: tokens.radius.md,
  padding: 16,
  marginBottom: 12,
  backgroundColor: tokens.surface.card,
},
```

- [ ] **4.4** The retry button currently has a plain grey border — update to match the design system:
```ts
retryButton: {
  paddingHorizontal: 24,
  paddingVertical: 10,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  backgroundColor: tokens.surface.card,
  marginTop: 8,
},
retryButtonText: {
  color: tokens.brand.ink,
  fontSize: 14,
  fontWeight: '500',
},
```

- [ ] **4.5** `statusActive` was `#27ae60` — after UI-1 this becomes `tokens.price.cheap` (`#22c55e`). Confirm.

### Phase 5 — Delete Account screen (`delete-account.tsx`)

- [ ] **5.1** Change root container background to `tokens.surface.page`.
  Remove `justifyContent: 'center'` from step 1 container — use top-anchored layout:
```ts
container: {
  flexGrow: 1,
  padding: 24,
  backgroundColor: tokens.surface.page,
},
```

- [ ] **5.2** Update `input` style to card background:
```ts
input: {
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  borderRadius: tokens.radius.md,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  backgroundColor: tokens.surface.card,
  marginBottom: 20,
},
```

- [ ] **5.3** The secondary (Cancel) button already uses outline style — update to match system:
```ts
secondaryButton: {
  paddingVertical: 14,
  borderRadius: tokens.radius.md,
  borderWidth: 1,
  borderColor: tokens.neutral.n200,
  backgroundColor: tokens.surface.card,
  alignItems: 'center',
},
secondaryButtonText: {
  color: tokens.brand.ink,
  fontSize: 15,
  fontWeight: '500',
},
```

- [ ] **5.4** `deleteButton` after UI-1 uses `tokens.price.expensive` — confirm it renders as `#ef4444`.
  `deleteButtonDisabled` should be `'#fca5a5'` (red-300) as specified in UI-1.

- [ ] **5.5** Remove the native header title duplication: `delete-account.tsx` currently shows a
  `<Text style={styles.title}>` in the JSX for step 1. Since UI-2 adds a native header with title
  "Delete Account", remove this `<Text>` element from the component. The step 2 title is different
  ("Are you sure?") — keep that one as it is content, not navigation chrome.

### Phase 6 — Final sweep

- [ ] **6.1** Run `grep -rn '"#' apps/mobile/app apps/mobile/src/components` — document any remaining
  raw hex strings. Accept only: inline `rgba(...)` in overlay/shadow styles (acceptable) and any
  `'#fffbeb'` amber-50 inline usage (acceptable). All others must use tokens.

- [ ] **6.2** `tsc --noEmit` — zero errors.

- [ ] **6.3** Visual smoke test: open each of the five screens, confirm background is warm grey, cards
  are white, buttons match the design system.

## Definition of Done

- All five screens use `tokens.surface.page` (`#f4f4f4`) as page background
- Activity rows are white cards on grey background
- Alerts toggles are inside a white card with border and radius
- Feedback TextInput has card background and n200 border
- Privacy Settings consent cards use `tokens.surface.card` + `tokens.radius.md`
- Delete Account uses top-anchored layout, card inputs, `tokens.price.expensive` delete button
- `tsc --noEmit` passes
- `grep -rn '"#' apps/mobile/app` returns only acceptable inline rgba/amber-50 values
