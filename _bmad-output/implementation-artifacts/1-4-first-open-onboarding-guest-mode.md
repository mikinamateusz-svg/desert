# Story 1.4: First-Open Onboarding & Guest Mode

Status: review

## Story

As a new driver,
I want to open the app and see the map immediately without being forced to register,
so that I can explore fuel prices before deciding whether to create an account.

**Why:** The no-registration-wall principle is central to desert's growth strategy — forcing sign-up before showing value kills conversion (the GasBuddy anti-pattern). The first-open experience must deliver immediate value (map with prices), offer a soft one-time sign-up prompt, and gate only the contribution action. Guest mode keeps the funnel wide open and lets the product speak for itself.

## Acceptance Criteria

1. **Given** a new user opens the app for the first time
   **When** the app finishes loading
   **Then** they see the map screen — no auth required
   **And** a one-time `SoftSignUpSheet` (bottom sheet) is shown with: "Track your savings and streak" + CTAs: Continue with Google · Continue with Apple · Use Email · Skip

2. **Given** a new user sees the `SoftSignUpSheet`
   **When** they tap Skip
   **Then** they enter guest mode and the sheet is dismissed
   **And** `hasSeenOnboarding = true` is persisted to AsyncStorage
   **And** the sheet is never shown again on any subsequent app open

3. **Given** a user who previously skipped the `SoftSignUpSheet`
   **When** they open the app again
   **Then** they go directly to the map with no prompt shown

4. **Given** a guest user on the `SoftSignUpSheet`
   **When** they tap Use Email
   **Then** the sheet is dismissed and they are navigated to `/(auth)/register`

5. **Given** a guest user on the `SoftSignUpSheet`
   **When** they tap Continue with Google
   **Then** the Google sign-in flow is triggered (inline, within the sheet — same as on the login screen)

6. **Given** a guest user on the `SoftSignUpSheet`
   **When** they tap Continue with Apple
   **Then** the Apple sign-in flow is triggered (inline, within the sheet)

7. **Given** a guest user who completes the camera flow for their first price submission (Epic 3)
   **When** the photo is ready to submit
   **Then** a `SignUpGateSheet` (bottom sheet) is shown: "Your photo is ready to submit" with CTAs: Continue with Google · Continue with Apple · Use Email
   **And** if they tap dismiss/back, the photo is discarded and they return to the map with no nag or penalty
   *(Note: the gate component is created here; it will be triggered by Epic 3. No camera integration in this story.)*

8. **Given** a user viewing the `SoftSignUpSheet` or `SignUpGateSheet`
   **When** their device language is set to Polish, English, or Ukrainian
   **Then** all text is displayed in that language

## Tasks / Subtasks

### Phase 1 — Auth Store: Guest Mode State

- [x] **1.1** Add `isGuest: boolean` and `hasSeenOnboarding: boolean` to `AuthState` interface in `apps/mobile/src/store/auth.store.ts`
- [x] **1.2** Add `skipOnboarding: () => Promise<void>` action to `AuthState`
- [x] **1.3** In `AuthProvider`, on mount restore `hasSeenOnboarding` from AsyncStorage key `'desert:hasSeenOnboarding'`
  - If key exists → set `hasSeenOnboarding = true`, `isGuest = true`
- [x] **1.4** Implement `skipOnboarding()`: persist `'desert:hasSeenOnboarding'` to AsyncStorage, set `hasSeenOnboarding = true`, `isGuest = true`
- [x] **1.5** On successful sign-in (any method), set `isGuest = false` (the user is now authenticated)
  - Note: `hasSeenOnboarding` stays true forever once set — this is intentional

### Phase 2 — Navigation: Allow Guests to Access Map

- [x] **2.1** Update `apps/mobile/app/index.tsx`:
  - `isLoading` → return `null`
  - `accessToken` → `<Redirect href="/(app)" />`
  - `isGuest` (hasSeenOnboarding, no token) → `<Redirect href="/(app)" />`
  - else → show `SoftSignUpSheet` over the map (`<Redirect href="/(app)" />` + sheet shown by `(app)/index.tsx`)
  - **Simplest approach:** always route to `/(app)`; show the sheet from `(app)/index.tsx` when `!accessToken && !hasSeenOnboarding`

- [x] **2.2** Update `apps/mobile/app/(app)/_layout.tsx`:
  - Remove hard redirect to login when unauthenticated
  - Allow both authenticated users (`accessToken`) and guests (`isGuest || hasSeenOnboarding`) to see the map
  - Only redirect to login if a contribution-gated action is attempted (handled at the action level, not layout level)

- [x] **2.3** Update `apps/mobile/app/index.tsx` to always route to `/(app)` (remove the forced `/(auth)/login` redirect for unauthenticated users)

### Phase 3 — SoftSignUpSheet Component

- [x] **3.1** Create `apps/mobile/src/components/SoftSignUpSheet.tsx`:
  - Props: `visible: boolean`, `onDismiss: () => void`
  - Renders as a `Modal` (or `View` overlay) with bottom-sheet style
  - Title: `t('auth.onboarding.title')` — "Track your savings and streak"
  - Subtitle: `t('auth.onboarding.subtitle')`
  - Contains `<GoogleSignInButton>` (reuse existing component)
  - Contains `<AppleSignInButton>` (reuse existing component, iOS only)
  - "Use Email" button → calls `onDismiss()` + navigate to `/(auth)/register`
  - "Skip" button → calls `skipOnboarding()` + `onDismiss()`
  - Both sign-in buttons: on success → `onDismiss()` (user is now authenticated, navigation handles the rest)
  - Error handling: same pattern as login screen (inline error text)

- [x] **3.2** Update `apps/mobile/app/(app)/index.tsx` (MapScreen):
  - Import `SoftSignUpSheet` and `useAuth`
  - Show `SoftSignUpSheet` when `!accessToken && !hasSeenOnboarding`
  - Pass `visible` and `onDismiss` props

### Phase 4 — SignUpGateSheet Component (stub for Epic 3)

- [x] **4.1** Create `apps/mobile/src/components/SignUpGateSheet.tsx`:
  - Props: `visible: boolean`, `onDismiss: () => void`
  - Title: `t('auth.gate.title')` — "Your photo is ready to submit"
  - Subtitle: `t('auth.gate.subtitle')`
  - Contains `<GoogleSignInButton>`
  - Contains `<AppleSignInButton>`
  - "Use Email" button → `onDismiss()` + navigate to `/(auth)/register`
  - "Discard" / dismiss: `onDismiss()` (photo discard handled by caller in Epic 3)
  - This component is fully built but NOT wired to any trigger in this story (Epic 3 will do that)

### Phase 5 — i18n

- [x] **5.1** Add onboarding and gate keys to all three locale files:

**`en.ts`:**
```ts
auth: {
  onboarding: {
    title: 'Track your savings and streak',
    subtitle: 'See which station near you is cheapest right now.',
    useEmail: 'Use Email',
    skip: 'Skip',
  },
  gate: {
    title: 'Your photo is ready to submit',
    subtitle: 'Create a free account to submit prices and track your savings.',
    useEmail: 'Use Email',
    discard: 'Discard and go back',
  },
}
```

**`pl.ts`:**
```ts
auth: {
  onboarding: {
    title: 'Śledź swoje oszczędności',
    subtitle: 'Zobacz, która stacja w pobliżu jest najtańsza.',
    useEmail: 'Użyj e-maila',
    skip: 'Pomiń',
  },
  gate: {
    title: 'Twoje zdjęcie jest gotowe do wysłania',
    subtitle: 'Utwórz bezpłatne konto, aby dodawać ceny i śledzić oszczędności.',
    useEmail: 'Użyj e-maila',
    discard: 'Odrzuć i wróć',
  },
}
```

**`uk.ts`:**
```ts
auth: {
  onboarding: {
    title: 'Відстежуйте свої заощадження',
    subtitle: 'Дізнайтесь, яка станція поруч найдешевша.',
    useEmail: 'Використати e-mail',
    skip: 'Пропустити',
  },
  gate: {
    title: 'Ваше фото готове до надсилання',
    subtitle: 'Створіть безкоштовний акаунт, щоб додавати ціни та відстежувати заощадження.',
    useEmail: 'Використати e-mail',
    discard: 'Відхилити та повернутись',
  },
}
```

### Phase 6 — Tests

- [x] **6.1** Unit tests for `AuthProvider` guest mode in `apps/mobile/src/store/auth.store.test.ts` (or equivalent):
  - `skipOnboarding()` persists AsyncStorage key and sets flags
  - On mount, restores `hasSeenOnboarding = true` when key exists
  - After sign-in, `isGuest` becomes false
  - *(Note: React Native context tests via `@testing-library/react-native` — check if test infra exists before writing; if not, skip and note)*

- [x] **6.2** If no mobile test infra: add a TODO comment in `auth.store.ts` and skip (mobile tests are covered by E2E in a future story)

## Dev Notes

### Current Navigation Architecture

```
app/index.tsx          ← routing entry point
  isLoading → null
  accessToken → /(app)
  else → /(auth)/login  ← THIS must change for guest mode

app/(app)/_layout.tsx  ← guards app section
  !accessToken → /(auth)/login  ← THIS must change

app/(app)/index.tsx    ← MapScreen (placeholder)
app/(auth)/_layout.tsx ← guards auth section (redirect to app if already signed in)
```

### Target Navigation Architecture (after this story)

```
app/index.tsx
  isLoading → null
  else → /(app)       ← always route to app; sheet logic lives in map screen

app/(app)/_layout.tsx
  isLoading → null
  else → render children (no forced redirect — guests are welcome)

app/(app)/index.tsx   ← MapScreen
  !accessToken && !hasSeenOnboarding → show SoftSignUpSheet
  else → show map normally

app/(auth)/_layout.tsx — unchanged (still redirects authenticated users away)
```

### Auth Store Shape (after this story)

```ts
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isGuest: boolean;           // NEW — true when hasSeenOnboarding && !accessToken
  hasSeenOnboarding: boolean; // NEW — true once SoftSignUpSheet shown (skipped or signed in)
  login: (...) => Promise<void>;
  register: (...) => Promise<void>;
  googleSignIn: (...) => Promise<void>;
  appleSignIn: (...) => Promise<void>;
  skipOnboarding: () => Promise<void>;  // NEW
  logout: () => Promise<void>;
}
```

### AsyncStorage Usage

Use `@react-native-async-storage/async-storage` — it is already available in the Expo managed workflow.

Key: `'desert:hasSeenOnboarding'` — string `'true'` when set.

Do NOT use SecureStore for this flag — it's not sensitive and SecureStore has OS-level requirements.

Import: `import AsyncStorage from '@react-native-async-storage/async-storage';`

### SoftSignUpSheet Implementation Pattern

Use React Native `Modal` with `transparent: true` + a semi-transparent overlay + bottom-anchored container:

```tsx
<Modal transparent visible={visible} animationType="slide" onRequestClose={onDismiss}>
  <Pressable style={styles.overlay} onPress={onDismiss} />
  <View style={styles.sheet}>
    {/* content */}
  </View>
</Modal>
```

Reuse `GoogleSignInButton` and `AppleSignInButton` components exactly as-is. They already handle sign-in via the auth store. On success they don't redirect themselves (the store sets `accessToken`, which causes `app/index.tsx` or the layout to re-render and navigate naturally).

### GoogleSignInButton and AppleSignInButton in the Sheet

These components already call `auth.googleSignIn()` and `auth.appleSignIn()` via the auth store. When sign-in succeeds, `accessToken` is set → `app/(app)/_layout.tsx` will keep showing children (user is now authenticated). The sheet just needs to detect sign-in success via the `accessToken` changing (or `onError` not firing) and call `onDismiss()`.

Simplest approach: wrap the buttons in the sheet, pass `onError` for error display. After sign-in, the route re-renders automatically due to `accessToken` being set, which will cause `hasSeenOnboarding` to be irrelevant (auth state wins). Just call `onDismiss()` unconditionally after the sign-in attempt completes without error.

Actually, even simpler: after `auth.googleSignIn()` or `auth.appleSignIn()` resolves without throwing, `accessToken` is set, and the parent component's re-render will close the sheet naturally (condition `!accessToken && !hasSeenOnboarding` becomes false). No explicit `onDismiss()` call needed on success.

### SignUpGateSheet — Placeholder Only

The gate sheet is created but has no caller in this story. Epic 3 (Photo Contribution Pipeline) will import it and show it when a guest tries to submit a photo. Export it from `apps/mobile/src/components/SignUpGateSheet.tsx`.

### What NOT to do

- Do NOT add navigation logic inside `GoogleSignInButton` or `AppleSignInButton` — they are stateless UI components, routing is handled by the store + layout
- Do NOT use SecureStore for `hasSeenOnboarding`
- Do NOT show `SoftSignUpSheet` on the login/register screens — it only appears over the map (first-open)
- Do NOT break the existing `(auth)/_layout.tsx` redirect (it correctly redirects authenticated users away from login)

### Previous Story Patterns (from 1.1–1.3)

- i18n: extend `auth` namespace with sub-namespaces; structure must match across all three locales
- Component files: `apps/mobile/src/components/` — PascalCase .tsx
- Auth store: `apps/mobile/src/store/auth.store.ts` — single file, `AuthProvider` + `useAuth` hook
- Error handling: `ApiError` from `apps/mobile/src/api/auth.ts`

### No API Changes

This story is entirely mobile-side. No new API endpoints, no backend changes.

### Contribution Gate — Epic 3 Integration Point

When Epic 3 is implemented, it will:
```tsx
import { SignUpGateSheet } from '../components/SignUpGateSheet';
// Show when guest tries to submit photo
```

The gate receives `onDismiss` which discards the photo and returns to map — the discard logic lives in Epic 3.
