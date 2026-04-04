# Story 1.2: Google Sign-In

Status: done

## Story

As a driver,
I want to sign up and sign in using my Google account,
so that I can get started without creating a new password.

## Acceptance Criteria

1. **Given** a new user taps "Continue with Google" on the sign-in or register screen
   **When** they complete the Google OAuth flow
   **Then** a `User` record is created with `role: DRIVER` and their Google identity linked via SuperTokens
   **And** they are signed in and land on the map screen

2. **Given** a returning driver who registered with Google
   **When** they tap "Continue with Google"
   **Then** they are signed back into their existing account — no duplicate `User` record is created

3. **Given** a driver who cancels the Google OAuth flow mid-way
   **When** they are returned to the app
   **Then** no account is created and they remain on the sign-in screen with no error

4. **Given** the Google OAuth flow completes successfully
   **When** the SuperTokens session is created
   **Then** the resulting JWT is accepted by the NestJS `JwtAuthGuard` on all protected API routes

5. **Given** a user views the sign-in or register screen
   **When** their device language is set to Polish, English, or Ukrainian
   **Then** all app-controlled text (including the Google button) is displayed in that language

## Tasks / Subtasks

### Phase 1 — Google Cloud Setup (HUMAN steps, prerequisite)

- [ ] **HUMAN TASK**: Create Google OAuth credentials
  - Go to [Google Cloud Console](https://console.cloud.google.com) → your project (or create one)
  - Enable "Google+ API" or "Google Identity" API if not already enabled
  - Navigate to Credentials → Create Credentials → OAuth 2.0 Client ID
  - Create **three** client IDs:

    | Type | Redirect URI / Identifier |
    |---|---|
    | Web application | `https://auth.expo.io` as Authorized Redirect URI |
    | Android | SHA-1 fingerprint of debug keystore + `com.desert.app` package |
    | iOS | `com.desert.app` bundle ID |

  - For Android debug SHA-1: run `keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android`
  - Note all three Client IDs
  - Add to Railway Variables: `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`
  - Add to `apps/api/.env` and update `apps/api/.env.example`
  - Add to `apps/mobile/.env` (Expo reads env at build time): `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`

### Phase 2 — API: ThirdParty recipe + Google endpoint

- [x] Task 1: Install google-auth-library (AC: 1,2,4)
  - `pnpm --filter @desert/api add google-auth-library`

- [x] Task 2: Add ThirdParty recipe to supertokens.ts (AC: 1,2)
  - Import `ThirdParty` from `supertokens-node/recipe/thirdparty/index.js`
  - Add `ThirdParty.init()` to `recipeList` (see Dev Notes — no providers needed)
  - **Do NOT remove or change** EmailPassword or Session init

- [x] Task 3: Create `apps/api/src/auth/dto/google-auth.dto.ts` (AC: 1,2)
  - Single field: `idToken: string` with `@IsString()` and `@IsNotEmpty()`

- [x] Task 4: Add `googleSignIn()` to AuthService (AC: 1,2,3,4)
  - Verify Google ID token using `OAuth2Client.verifyIdToken`
  - Call `ThirdParty.manuallyCreateOrUpdateUser`
  - Branch on `createdNewRecipeUser` to create vs find User record
  - Create SuperTokens session with `Session.createNewSessionWithoutRequestResponse`
  - See Dev Notes for full implementation

- [x] Task 5: Add `POST /v1/auth/google` to AuthController (AC: 1,2)
  - `@HttpCode(200)` — no auth guard (public endpoint)
  - Accepts `GoogleAuthDto`, delegates to `authService.googleSignIn(body.idToken)`

- [x] Task 6: Write unit tests for googleSignIn (AC: 1,2,4)
  - Test: new Google user creates User record and returns access token
  - Test: existing Google user returns existing User record (no duplicate)
  - Test: invalid id_token throws 401 with `INVALID_GOOGLE_TOKEN`
  - Test: `SIGN_IN_UP_NOT_ALLOWED` from SuperTokens throws 409 with `SOCIAL_EMAIL_CONFLICT`
  - Mock `google-auth-library` OAuth2Client and supertokens ThirdParty

### Phase 3 — Mobile: Google sign-in flow

- [x] Task 7: Install expo-auth-session packages (AC: 1,2,3)
  - `pnpm --filter @desert/mobile add expo-auth-session expo-crypto expo-web-browser`
  - These are managed expo packages — use `npx expo install` if versions conflict

- [x] Task 8: Add `apiGoogleSignIn()` to `apps/mobile/src/api/auth.ts` (AC: 1,2)
  - POST to `/v1/auth/google` with `{ idToken }`
  - Follow same pattern as `apiLogin` — returns `{ user, accessToken }`, throws `ApiError` on failure

- [x] Task 9: Add `googleSignIn()` action to `apps/mobile/src/store/auth.store.ts` (AC: 1,2)
  - Accepts `idToken: string`, calls `apiGoogleSignIn`, saves token + user state
  - Follow same pattern as existing `login()` action

- [x] Task 10: Create `apps/mobile/src/components/GoogleSignInButton.tsx` (AC: 1,2,3)
  - Uses `Google.useIdTokenAuthRequest` (NOT `useAuthRequest`) — see Dev Notes
  - Calls `WebBrowser.maybeCompleteAuthSession()` at module level (critical — see Dev Notes)
  - On success: extracts `response.params.id_token`, calls `auth.googleSignIn(idToken)`
  - On cancel (`response.type === 'dismiss'`): no-op, no error shown
  - Shows loading state while request is in-flight; disables button while `request` is null

- [x] Task 11: Add GoogleSignInButton to login and register screens (AC: 1,2,3,5)
  - Add "Continue with Google" button below existing form in `apps/mobile/app/(auth)/login.tsx`
  - Add "Continue with Google" button below existing form in `apps/mobile/app/(auth)/register.tsx`
  - Add a divider ("or") between form submit and Google button
  - Use translated strings for button label and divider

### Phase 4 — i18n: Add Google strings

- [x] Task 12: Update i18n locale files (AC: 5)
  - Add `auth.common` namespace with keys: `continueWithGoogle`, `orDivider`, `socialEmailConflict`, `invalidGoogleToken`
  - Update `en.ts`, `pl.ts`, `uk.ts` — see Dev Notes for key values

### Phase 5 — .env.example update

- [x] Task 13: Update `apps/api/.env.example` with Google client ID vars

## Dev Notes

### Architecture: How Google Sign-In Works in This Stack

```
Mobile (expo-auth-session)
  → useIdTokenAuthRequest prompts Google OAuth
  → Google returns id_token (JWT signed by Google)
  → Mobile sends id_token to POST /v1/auth/google

API (NestJS)
  → Verifies id_token with google-auth-library (local JWT check, no network needed after initial key fetch)
  → Extracts: payload.sub (Google user ID), payload.email, payload.email_verified, payload.name
  → ThirdParty.manuallyCreateOrUpdateUser('public', 'google', sub, email, email_verified)
  → If new user: CREATE User record (supertokens_id = stUser.id, display_name from payload.name)
  → If existing user: FIND User record (WHERE supertokens_id = stUser.id)
  → Session.createNewSessionWithoutRequestResponse → returns accessToken
```

SuperTokens is used for user record management and session creation only. Google OAuth token exchange happens entirely on the mobile side (PKCE via expo-auth-session). This avoids the need to configure a redirect URI on the SuperTokens managed service.

---

### CRITICAL: supertokens-node v24 ThirdParty Recipe

**The combined `ThirdPartyEmailPassword` recipe was removed in supertokens-node v17.0.0.** Do NOT import or use it — it will throw at runtime. The correct v24 pattern is two separate recipes:

```ts
recipeList: [
  ThirdParty.init(),       // separate from EmailPassword
  EmailPassword.init(),
  Session.init({ getTokenTransferMethod: () => 'header' }),
]
```

`ThirdParty.init()` with no `providers` config is valid — we use `manuallyCreateOrUpdateUser` which bypasses the built-in OAuth flow entirely.

**Note:** `manuallyCreateOrUpdateUser` does NOT trigger override hooks set in `ThirdParty.init({ override: { apis: ... } })`. Any post-signup logic (like assigning roles) must be run manually in `AuthService.googleSignIn()` — which is already what we do when creating the User DB record.

---

### API: supertokens.ts — Updated initSuperTokens

```ts
import SuperTokens from 'supertokens-node';
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import EmailPassword from 'supertokens-node/recipe/emailpassword/index.js';
import Session from 'supertokens-node/recipe/session/index.js';

export function initSuperTokens(connectionUri: string, apiKey: string) {
  SuperTokens.init({
    framework: 'custom',
    supertokens: { connectionURI: connectionUri, apiKey },
    appInfo: {
      appName: 'desert',
      apiDomain: process.env['API_URL'] ?? 'http://localhost:3000',
      websiteDomain: process.env['WEB_URL'] ?? 'http://localhost:3001',
      apiBasePath: '/v1/auth',
    },
    recipeList: [
      ThirdParty.init(),   // no providers — uses manuallyCreateOrUpdateUser
      EmailPassword.init(),
      Session.init({ getTokenTransferMethod: () => 'header' }),
    ],
  });
}
```

---

### API: GoogleAuthDto — `apps/api/src/auth/dto/google-auth.dto.ts`

```ts
import { IsString, IsNotEmpty } from 'class-validator';

export class GoogleAuthDto {
  @IsString()
  @IsNotEmpty()
  idToken!: string;
}
```

---

### API: AuthService.googleSignIn() — Full Implementation

```ts
import ThirdParty from 'supertokens-node/recipe/thirdparty/index.js';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

// Add to AuthService class:
private readonly googleClient = new OAuth2Client();

async googleSignIn(idToken: string) {
  // 1. Verify Google ID token
  let payload: TokenPayload;
  try {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: [
        process.env['GOOGLE_WEB_CLIENT_ID'],
        process.env['GOOGLE_ANDROID_CLIENT_ID'],
        process.env['GOOGLE_IOS_CLIENT_ID'],
      ].filter(Boolean) as string[],
    });
    payload = ticket.getPayload()!;
  } catch {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'INVALID_GOOGLE_TOKEN',
      message: 'Invalid Google ID token',
    });
  }

  if (!payload.email) {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'GOOGLE_EMAIL_MISSING',
      message: 'Google account has no email address',
    });
  }

  // 2. Create or find SuperTokens ThirdParty user
  const result = await ThirdParty.manuallyCreateOrUpdateUser(
    'public',           // tenantId
    'google',           // thirdPartyId
    payload.sub,        // thirdPartyUserId (Google's stable user ID)
    payload.email,
    payload.email_verified ?? false,
    undefined,          // session (no account linking)
    {},                 // userContext
  );

  if (result.status === 'SIGN_IN_UP_NOT_ALLOWED') {
    throw new ConflictException({
      statusCode: 409,
      error: 'SOCIAL_EMAIL_CONFLICT',
      message: result.reason,
    });
  }

  if (result.status !== 'OK') {
    throw new Error(`SuperTokens ThirdParty signInUp failed: ${result.status}`);
  }

  const { user: stUser, recipeUserId, createdNewRecipeUser } = result;

  // 3. Find or create our User record
  let user;
  if (createdNewRecipeUser) {
    user = await this.prisma.user.create({
      data: {
        supertokens_id: stUser.id,
        email: payload.email,
        display_name: payload.name ?? null,
        role: 'DRIVER',
      },
    });
  } else {
    user = await this.prisma.user.findUniqueOrThrow({
      where: { supertokens_id: stUser.id },
    });
  }

  // 4. Create SuperTokens session (same pattern as email/password login)
  const session = await Session.createNewSessionWithoutRequestResponse(
    'public',
    recipeUserId,
    { userId: user.id, role: user.role },
  );

  return { user, accessToken: session.getAccessToken() };
}
```

**`manuallyCreateOrUpdateUser` return type — handle all status values:**

| Status | Meaning | Action |
|---|---|---|
| `OK` | User created or found | Proceed — use `createdNewRecipeUser` to branch |
| `SIGN_IN_UP_NOT_ALLOWED` | Same email linked to another recipe and account linking blocked | Return 409 `SOCIAL_EMAIL_CONFLICT` |
| `EMAIL_CHANGE_NOT_ALLOWED_ERROR` | User exists but email in payload changed, and that email is taken | Return 409 |

**`createdNewRecipeUser` semantics:**
- `true` → brand new Google user → CREATE User record in our DB
- `false` → returning Google user → FIND existing User record (`WHERE supertokens_id = stUser.id`)

**`stUser.id` is the SuperTokens primary user UUID** — same concept as `stUser.id` used in Story 1.1 for EmailPassword. Always store this as `supertokens_id`.

---

### API: AuthController — Add POST /v1/auth/google

```ts
@Post('google')
@HttpCode(200)
googleAuth(@Body() body: GoogleAuthDto) {
  return this.authService.googleSignIn(body.idToken);
}
```

Import `GoogleAuthDto` from `./dto/google-auth.dto.js`.

---

### Mobile: expo-auth-session — useIdTokenAuthRequest

**Use `Google.useIdTokenAuthRequest` (NOT `useAuthRequest`).** The `useAuthRequest` hook returns an `authentication` object where `idToken` is often `undefined` on native — a known long-standing bug. `useIdTokenAuthRequest` uses the implicit flow specifically to return `id_token` reliably in `response.params.id_token`.

```ts
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

// CRITICAL: Must be called at module level (outside component), not inside useEffect
WebBrowser.maybeCompleteAuthSession();
```

**`WebBrowser.maybeCompleteAuthSession()` at module level is mandatory.** Without it, the OAuth redirect back to the app never completes the session on iOS.

```ts
const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
  clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
});
```

**Response handling in `useEffect`:**
```ts
useEffect(() => {
  if (response?.type === 'success') {
    const idToken = response.params.id_token;
    // idToken is now reliably present
    handleGoogleSignIn(idToken);
  }
  // response.type === 'dismiss' → user cancelled → no-op, no error
}, [response]);
```

**`request` is null until expo-auth-session loads** → disable the button while `!request`.

---

### Mobile: GoogleSignInButton Component — `apps/mobile/src/components/GoogleSignInButton.tsx`

```ts
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../store/auth.store.js';
import { ApiError } from '../api/auth.js';
import { useEffect, useState } from 'react';

WebBrowser.maybeCompleteAuthSession(); // module level

interface Props {
  onError?: (code: string) => void;
}

export function GoogleSignInButton({ onError }: Props) {
  const { t } = useTranslation();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const idToken = response.params.id_token;
    setLoading(true);
    auth.googleSignIn(idToken)
      .catch((err) => {
        const code = err instanceof ApiError ? err.error : 'UNKNOWN_ERROR';
        onError?.(code);
      })
      .finally(() => setLoading(false));
  }, [response]);

  return (
    <TouchableOpacity
      disabled={!request || loading}
      onPress={() => promptAsync()}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Text>{t('auth.common.continueWithGoogle')}</Text>
      )}
    </TouchableOpacity>
  );
}
```

---

### Mobile: Auth API Client — Add to `apps/mobile/src/api/auth.ts`

```ts
export async function apiGoogleSignIn(
  idToken: string,
): Promise<{ user: AuthUser; accessToken: string }> {
  const response = await fetch(`${API_BASE_URL}/v1/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new ApiError(
      response.status,
      body.error ?? 'UNKNOWN_ERROR',
      body.message ?? 'Google sign-in failed',
    );
  }
  return response.json();
}
```

---

### Mobile: Auth Store — Add googleSignIn Action

Add to `AuthProvider` / `AuthState` interface and implementation alongside the existing `login()` and `register()` actions:

```ts
googleSignIn: async (idToken: string) => {
  const { user, accessToken } = await apiGoogleSignIn(idToken);
  await saveToken(accessToken);
  setState({ user, accessToken, isLoading: false });
},
```

---

### i18n Keys to Add

Add `auth.common` to all three locale files:

```ts
// en.ts — add to auth namespace
common: {
  continueWithGoogle: 'Continue with Google',
  orDivider: 'or',
  socialEmailConflict: 'This email is already registered. Please sign in with your email and password.',
  invalidGoogleToken: 'Google sign-in failed. Please try again.',
  googleEmailMissing: 'Your Google account has no email address. Please use email sign-in.',
},
```

```ts
// pl.ts
common: {
  continueWithGoogle: 'Kontynuuj z Google',
  orDivider: 'lub',
  socialEmailConflict: 'Ten email jest już zarejestrowany. Zaloguj się przy użyciu emaila i hasła.',
  invalidGoogleToken: 'Logowanie przez Google nie powiodło się. Spróbuj ponownie.',
  googleEmailMissing: 'Twoje konto Google nie ma adresu email. Użyj logowania przez email.',
},
```

```ts
// uk.ts
common: {
  continueWithGoogle: 'Продовжити з Google',
  orDivider: 'або',
  socialEmailConflict: 'Цей email вже зареєстровано. Будь ласка, увійдіть за допомогою email та пароля.',
  invalidGoogleToken: 'Не вдалося увійти через Google. Спробуйте ще раз.',
  googleEmailMissing: 'Ваш акаунт Google не має email-адреси. Скористайтесь входом через email.',
},
```

---

### Environment Variables — Full Set for Story 1.2

Add to `apps/api/.env.example`:
```
GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com
```

Add to `apps/mobile/.env.example` (Expo uses `EXPO_PUBLIC_` prefix):
```
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=xxxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com
```

Add to Railway Variables (production) and local `.env` files.

---

### UX Constraints

1. "Continue with Google" button appears on both login and register screens — users shouldn't need to know which screen to use.
2. A visual divider ("or") separates the email form from the Google button.
3. While Google OAuth is in progress: show spinner on button, disable all inputs.
4. If user cancels OAuth flow: no error shown — silent no-op. User remains on the screen.
5. Error codes map to i18n keys: `SOCIAL_EMAIL_CONFLICT` → `auth.common.socialEmailConflict`, `INVALID_GOOGLE_TOKEN` → `auth.common.invalidGoogleToken`.
6. The "Continue with Google" button is NOT shown in `SoftSignUpSheet` (Story 1.4) or `SignUpGateScreen` (Story 3.1) — those are separate components built in those stories.

[Source: ux-design-specification.md — Journey 3, Journey 4, SoftSignUpSheet component spec]

---

### Machine-Readable Error Codes

All errors follow the `{ statusCode, error, message }` shape established in Story 1.1:

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_GOOGLE_TOKEN` | 401 | Google ID token failed verification |
| `GOOGLE_EMAIL_MISSING` | 401 | Google account has no email (rare) |
| `SOCIAL_EMAIL_CONFLICT` | 409 | Same email already exists via EmailPassword recipe |

---

### Testing Standards

- Mock `google-auth-library` with `jest.mock('google-auth-library')`
- Mock `supertokens-node/recipe/thirdparty/index.js` same pattern as EmailPassword mocks from Story 1.1 (requires `__esModule: true` in mock factory)
- Test `createdNewRecipeUser: true` → prisma.user.create called
- Test `createdNewRecipeUser: false` → prisma.user.findUniqueOrThrow called
- Do NOT write integration tests hitting real Google API

```ts
// Mock factory pattern (required — same as Story 1.1 lesson):
jest.mock('google-auth-library', () => ({
  __esModule: true,
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

jest.mock('supertokens-node/recipe/thirdparty/index.js', () => ({
  __esModule: true,
  default: {
    manuallyCreateOrUpdateUser: jest.fn(),
  },
}));
```

---

### Previous Story Learnings (from Story 1.1)

- **`__esModule: true` in mock factories is mandatory** — ts-jest wraps default imports with `__importDefault`; without `__esModule: true`, mocking supertokens recipes results in `undefined` function calls
- **Import paths use `.js` extension** throughout NestJS API (`supertokens-node/recipe/thirdparty/index.js` not `supertokens-node/recipe/thirdparty`)
- **`supertokens_id = stUser.id` (not recipeUserId)** — `user.id` is the SuperTokens primary user UUID; `recipeUserId` is passed to `createNewSessionWithoutRequestResponse`
- **PrismaService imports from `@prisma/client` directly** (already implemented, no change needed)
- **NestJS uses `.js` extensions** in all relative imports (e.g., `'./auth.service.js'`, `'./dto/google-auth.dto.js'`)
- **Global ValidationPipe with `transform: true`** is already set up — `GoogleAuthDto` decorators will work automatically

---

### Project Structure Notes

- New files go in `apps/api/src/auth/` (DTO, service method additions, controller additions)
- New mobile component: `apps/mobile/src/components/GoogleSignInButton.tsx`
- `supertokens.ts` is modified (add ThirdParty import + init)
- `auth.service.ts` is modified (add `googleSignIn` method + `googleClient` property)
- `auth.controller.ts` is modified (add `googleAuth` endpoint)
- `auth.module.ts` is NOT changed (ThirdParty recipe is initialized in supertokens.ts, no new module needed)
- NestJS `.js` import convention applies to all new imports

### References

- [Source: epics.md — Story 1.2, lines 364–393]
- [Source: architecture.md — Decision 3: Authentication & RBAC]
- [Source: ux-design-specification.md — Journey 3 First Open, Journey 4 Sign-Up at First Contribution]
- [Source: apps/api/src/auth/auth.service.ts — existing register/login patterns to follow]
- [Source: apps/api/src/auth/supertokens.ts — initSuperTokens to update]
- [Source: apps/mobile/app.json — scheme: "desert", bundleIdentifier: "com.desert.app", package: "com.desert.app"]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Completion Notes List

- `google-auth-library` installed in `@desert/api`; `expo-auth-session`, `expo-crypto`, `expo-web-browser` installed in `@desert/mobile`
- `supertokens.ts` updated: `ThirdParty.init()` added to `recipeList` before `EmailPassword.init()` — no providers config (uses `manuallyCreateOrUpdateUser` directly)
- `GoogleAuthDto` created with `@IsString()` + `@IsNotEmpty()` on `idToken`
- `AuthService.googleSignIn()`: verifies Google ID token via `OAuth2Client.verifyIdToken`, calls `ThirdParty.manuallyCreateOrUpdateUser`, branches on `createdNewRecipeUser` to create vs find User record, creates SuperTokens session with `createNewSessionWithoutRequestResponse`
- `AuthController`: `POST /v1/auth/google` added with `@HttpCode(200)`, no auth guard
- 6 new tests added (4 in `auth.service.spec.ts`, 2 in `auth.controller.spec.ts`); all 26 tests pass
- `GoogleSignInButton` component created: uses `Google.useIdTokenAuthRequest` (not `useAuthRequest`), `WebBrowser.maybeCompleteAuthSession()` at module level, loading state, cancel is silent no-op
- `apiGoogleSignIn()` added to `apps/mobile/src/api/auth.ts`
- `googleSignIn()` action added to `AuthProvider` and `AuthState` interface in `auth.store.ts`
- `GoogleSignInButton` added to login and register screens with "or" divider
- `auth.common` i18n namespace added to `en.ts`, `pl.ts`, `uk.ts` with 5 keys
- `apps/api/.env.example` and `apps/mobile/.env.example` updated with Google client ID vars

### File List

- `apps/api/src/auth/supertokens.ts` — added ThirdParty.init() to recipeList
- `apps/api/src/auth/dto/google-auth.dto.ts` — new DTO
- `apps/api/src/auth/auth.service.ts` — added googleSignIn() method + OAuth2Client property
- `apps/api/src/auth/auth.controller.ts` — added POST /v1/auth/google endpoint
- `apps/api/src/auth/auth.service.spec.ts` — added 4 googleSignIn tests + google-auth-library + ThirdParty mocks
- `apps/api/src/auth/auth.controller.spec.ts` — added 2 googleAuth tests
- `apps/api/.env.example` — added GOOGLE_*_CLIENT_ID vars
- `apps/mobile/src/api/auth.ts` — added apiGoogleSignIn()
- `apps/mobile/src/store/auth.store.ts` — added googleSignIn() to AuthState + AuthProvider
- `apps/mobile/src/components/GoogleSignInButton.tsx` — new component
- `apps/mobile/app/(auth)/login.tsx` — added GoogleSignInButton + divider
- `apps/mobile/app/(auth)/register.tsx` — added GoogleSignInButton + divider
- `apps/mobile/src/i18n/locales/en.ts` — added auth.common namespace
- `apps/mobile/src/i18n/locales/pl.ts` — added auth.common namespace
- `apps/mobile/src/i18n/locales/uk.ts` — added auth.common namespace
- `apps/mobile/.env.example` — new file with EXPO_PUBLIC_GOOGLE_* vars

## Review Patches (2026-04-04)

### P-3 Applied — GOOGLE_EMAIL_MISSING shown as wrong error in login/register screens
`apps/mobile/app/(auth)/login.tsx` and `register.tsx`: `handleGoogleError` fell through to the generic "Invalid Google token" message for `GOOGLE_EMAIL_MISSING`. Added explicit case mapping to `auth.common.googleEmailMissing` (i18n key already existed; `SignUpGateSheet`/`SoftSignUpSheet` already handled this correctly — login/register were missed).

### P-3 Applied — GoogleAuthDto.idToken missing @MaxLength
`apps/api/src/auth/dto/google-auth.dto.ts`: Added `@MaxLength(2048)` to prevent oversized token payloads reaching `OAuth2Client.verifyIdToken`. Google JWTs are ~1KB; 2048 chars provides headroom while capping abuse.

**Note:** Several higher-severity issues were already fixed in commit `8689ebb` prior to this review (empty-audience bypass P-1, P2002 guard, `auth` dep in useEffect, user field leak fixed in 1.1 review).

## Review Deferred Items (2026-04-04)

- **D1**: `GoogleAuthDto.idToken` is additionally bounded by Fastify's 1MB body limit — the `@MaxLength(2048)` patch above is belt-and-suspenders.
- **D2**: `handleGoogleError` in login/register uses a shared handler for both Google and Apple errors (Apple errors also go through it). Currently shows `auth.common.invalidGoogleToken` for Apple errors that aren't `SOCIAL_EMAIL_CONFLICT` — acceptable for MVP since Apple errors are handled in their own dedicated component in later stories.
