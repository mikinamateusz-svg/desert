# Story UI-3: Account Screen Redesign

Status: done

## Story

As a **driver**,
I want the Account screen to look polished and on-brand,
So that settings feel like part of the same app as the map, not a developer placeholder.

## Why

The Account screen is accessed via the hamburger button in the map chrome (not a tab). When the user
taps the hamburger on the map, this screen slides in with a native back button — it needs to feel
polished on first impression.

The current Account screen is `justifyContent: 'center'` — everything floats in the middle of a plain
white screen with no visual hierarchy. Buttons are grey outline boxes. The delete CTA uses an off-palette
red. There is no screen title or user context. Compared to the map, it feels like a different product.

## Acceptance Criteria

1. **Given** a signed-in user opens the Account tab **When** the screen renders **Then** a circular avatar
   showing the user's initials (or a generic icon for guests) is visible near the top of the screen
   alongside the user's display name or email.

2. **Given** the Account screen **When** rendered **Then** the background is `tokens.surface.page`
   (`#f4f4f4`), not white.

3. **Given** the screen layout **When** rendered **Then** content is top-anchored in a `ScrollView`,
   not vertically centred.

4. **Given** the action buttons **When** rendered **Then** they use the defined button system:
   - Sign Out: outline style (border `tokens.neutral.n200`, text `tokens.brand.ink`)
   - Export My Data: outline style
   - Privacy Settings: outline style
   - Send Feedback: outline style
   All buttons span full width with generous padding and `borderRadius: tokens.radius.md`.

5. **Given** the Delete Account link **When** rendered **Then** it uses `tokens.price.expensive`
   (`#ef4444`) as the text colour, not `#c0392b`.

6. **Given** the language selector **When** the active language is selected **Then** the button shows
   `borderColor: tokens.brand.accent`, `backgroundColor: '#fffbeb'`, and text `tokens.brand.accent`.
   Inactive buttons show `borderColor: tokens.neutral.n200`, text `tokens.neutral.n500`.

7. **Given** all three languages (EN, PL, UK) **When** the screen renders **Then** all text is
   localised with no hardcoded strings.

8. **Given** `tsc --noEmit` **When** run **Then** zero type errors.

## Tasks / Subtasks

**Prerequisite:** UI-1 tokens must exist. UI-2 navigation must be complete (Account is registered as
`href: null` in the Tabs layout, so it gets a native header with back button when pushed from the map chrome).
UI-4 chrome buttons trigger `router.push('/(app)/account')` to open this screen.

### Phase 1 — Redesign `account.tsx`

- [ ] **1.1** Replace the `StyleSheet` and component JSX with the implementation below.
  The logic (handlers, state) is unchanged — only the visual layer is updated.

```tsx
// account.tsx — visual layer only, logic unchanged from existing file

return (
  <SafeAreaView style={styles.safeArea} edges={['top']}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      alwaysBounceVertical={false}
    >
      {/* ── Avatar + identity ── */}
      <View style={styles.identitySection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarInitials}>
            {getInitials(user?.display_name ?? user?.email ?? 'G')}
          </Text>
        </View>
        <Text style={styles.displayName}>
          {user?.display_name ?? user?.email ?? t('account.guest')}
        </Text>
      </View>

      {/* ── Language selector ── */}
      <Text style={styles.sectionLabel}>{t('account.languageLabel')}</Text>
      <View style={styles.langRow}>
        {SUPPORTED_LOCALES.map((lang) => (
          <TouchableOpacity
            key={lang}
            style={[styles.langButton, currentLang === lang && styles.langButtonActive]}
            onPress={() => void handleLanguageChange(lang)}
          >
            <Text style={[styles.langButtonText, currentLang === lang && styles.langButtonTextActive]}>
              {t(`account.language.${lang}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Actions ── */}
      <View style={styles.actionsSection}>
        <TouchableOpacity style={styles.button} onPress={logout}>
          <Text style={styles.buttonText}>{t('account.signOut')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, isExporting && styles.buttonDisabled]}
          onPress={handleExportData}
          disabled={isExporting}
        >
          {isExporting
            ? <ActivityIndicator size="small" color={tokens.neutral.n500} />
            : <Text style={styles.buttonText}>{t('account.exportDataButton')}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/privacy-settings')}>
          <Text style={styles.buttonText}>{t('account.privacySettings')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => router.push('/(app)/feedback')}>
          <Text style={styles.buttonText}>{t('account.sendFeedback')}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Destructive zone ── */}
      <TouchableOpacity
        style={styles.deleteRow}
        onPress={() => router.push('/(app)/delete-account')}
      >
        <Text style={styles.deleteText}>{t('account.deleteAccountButton')}</Text>
      </TouchableOpacity>
    </ScrollView>
  </SafeAreaView>
);
```

- [ ] **1.2** Add the `getInitials` helper above the component:
```ts
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
```

- [ ] **1.3** Import `SafeAreaView` from `react-native-safe-area-context` (already a dependency via Expo):
```ts
import { SafeAreaView } from 'react-native-safe-area-context';
```

- [ ] **1.4** Replace the `StyleSheet.create` block:

```ts
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: tokens.surface.page,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },

  // Identity
  identitySection: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: tokens.brand.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarInitials: {
    fontSize: 26,
    fontWeight: '700',
    color: tokens.neutral.n0,
  },
  displayName: {
    fontSize: 17,
    fontWeight: '600',
    color: tokens.brand.ink,
  },

  // Language
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: tokens.neutral.n400,
    marginBottom: 10,
  },
  langRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 28,
  },
  langButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    alignItems: 'center',
    backgroundColor: tokens.surface.card,
  },
  langButtonActive: {
    borderColor: tokens.brand.accent,
    backgroundColor: '#fffbeb',
  },
  langButtonText: {
    fontSize: 14,
    color: tokens.neutral.n500,
    fontWeight: '500',
  },
  langButtonTextActive: {
    color: tokens.brand.accent,
    fontWeight: '700',
  },

  // Action buttons
  actionsSection: {
    gap: 12,
    marginBottom: 32,
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.neutral.n200,
    backgroundColor: tokens.surface.card,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 15,
    color: tokens.brand.ink,
    fontWeight: '500',
  },

  // Destructive
  deleteRow: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  deleteText: {
    fontSize: 14,
    color: tokens.price.expensive,
    fontWeight: '500',
  },
});
```

### Phase 2 — Add i18n keys

- [ ] **2.1** Add `'account.guest'` and `'account.languageLabel'` to all three locales:

  **en.ts:**
  ```ts
  guest: 'Guest',
  languageLabel: 'Language',
  ```
  **pl.ts:**
  ```ts
  guest: 'Gość',
  languageLabel: 'Język',
  ```
  **uk.ts:**
  ```ts
  guest: 'Гість',
  languageLabel: 'Мова',
  ```

### Phase 3 — Verify

- [ ] **3.1** Sign-in flow: verify avatar shows first+last initials for "Jan Kowalski" → "JK".
- [ ] **3.2** Guest state: verify avatar shows "GU" initials (from "Guest").
- [ ] **3.3** Long email: verify display name truncates gracefully (`numberOfLines={1}` if needed).
- [ ] **3.4** All 4 action buttons visible and tappable.
- [ ] **3.5** Delete CTA is `#ef4444` (red), not `#c0392b`.
- [ ] **3.6** Background is `#f4f4f4` (warm grey), not white.
- [ ] **3.7** `tsc --noEmit` passes.

## Definition of Done

- Screen has avatar + name identity section at top
- Background is `tokens.surface.page` (`#f4f4f4`)
- Content is top-anchored in a `ScrollView`
- All buttons use outline card style with `tokens.radius.md` border radius
- Delete CTA uses `tokens.price.expensive` (`#ef4444`)
- Language selector uses amber active state
- All strings localised in EN, PL, UK
- `tsc --noEmit` passes

## Review Notes (2026-04-04)

No patches. Account screen redesign clean. Correct use of design tokens.
