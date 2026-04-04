# Story 1.3: Apple Sign-In

Status: done

## Story

As a driver,
I want to sign up and sign in using my Apple account,
so that I can get started privately without sharing my email if I choose not to.

**Why:** Apple sign-in is mandatory for App Store approval whenever any other social sign-in is offered. It is the preferred sign-in method for a significant portion of iOS users. Skipping it blocks iOS launch.

## Acceptance Criteria

1. **Given** a new user taps "Continue with Apple" on the sign-in or register screen
   **When** they complete the Apple OAuth flow
   **Then** a `User` record is created with `role: DRIVER` and their Apple identity linked via SuperTokens
   **And** they are signed in and land on the map screen

2. **Given** a driver who uses Apple's "Hide My Email" option during sign-up
   **When** their account is created
   **Then** the Apple-generated relay email (`xyz@privaterelay.appleid.com`) is stored and the app functions identically regardless of email type

3. **Given** a returning driver who registered with Apple
   **When** they tap "Continue with Apple"
   **Then** they are signed back into their existing account — no duplicate `User` record is created

4. **Given** a driver who cancels the Apple OAuth flow mid-way
   **When** they are returned to the app
   **Then** no account is created and they remain on the sign-in screen with no error

5. **Given** the app is submitted to the App Store with Google sign-in present
   **When** Apple reviews the app
   **Then** Apple sign-in is also present on the same screen (App Store compliance)

6. **Given** a user views the sign-in or register screen on iOS
   **When** their device language is set to Polish, English, or Ukrainian
   **Then** all app-controlled text is displayed in that language (the native Apple button renders in the system language automatically)

## Tasks / Subtasks

### Phase 1 — Apple Developer Setup (HUMAN steps, prerequisite)

- [ ] **HUMAN TASK**: Enable Sign in with Apple on App ID
  - Go to [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → Identifiers
  - Find your App ID matching `com.desert.app` (or create it)
  - Edit → enable **Sign in with Apple** capability → Save
  - This is all that's needed for the native iOS flow — no Service ID required

### Phase 2 — app.json update

- [ ] Task 1: Add `usesAppleSignIn: true` to `app.json` iOS section (AC: 1)
  - Required for EAS Build to add the Sign in with Apple entitlement automatically
  - See Dev Notes for exact change

### Phase 3 — API: Apple token verification + endpoint

- [ ] Task 2: Install apple-signin-auth (AC: 1,2,3)
  - `pnpm --filter @desert/api add apple-signin-auth`

- [ ] Task 3: Create `apps/api/src/auth/dto/apple-auth.dto.ts` (AC: 1,2)
  - `identityToken: string` — required
  - `fullName` — optional nested object with `givenName` and `familyName` (nullable strings)
  - See Dev Notes for full DTO

- [ ] Task 4: Add `appleSignIn()` to AuthService (AC: 1,2,3,4)
  - Verify Apple identity token using `apple-signin-auth`
  - Call `ThirdParty.manuallyCreateOrUpdateUser` (ThirdParty recipe already initialized in Story 1.2)
  - Branch on `createdNewRecipeUser` to create vs find User record
  - On first sign-in (`createdNewRecipeUser = true`): build `display_name` from `fullName` param
  - Create SuperTokens session with `Session.createNewSessionWithoutRequestResponse`
  - See Dev Notes for full implementation

- [ ] Task 5: Add `POST /v1/auth/apple` to AuthController (AC: 1,2)
  - `@HttpCode(200)`, no auth guard (public endpoint)
  - Accepts `AppleAuthDto`, delegates to `authService.appleSignIn(dto.identityToken, dto.fullName)`

- [ ] Task 6: Write unit tests for appleSignIn (AC: 1,2,3,4)
  - Test: new Apple user (first sign-in with fullName) creates User record with display_name
  - Test: returning Apple user finds existing User record (no duplicate)
  - Test: invalid identity token throws 401 with `INVALID_APPLE_TOKEN`
  - Test: `SIGN_IN_UP_NOT_ALLOWED` from SuperTokens throws 409 with `SOCIAL_EMAIL_CONFLICT`
  - Mock `apple-signin-auth` and ThirdParty (already mocked pattern from Story 1.2)

### Phase 4 — Mobile: Apple sign-in flow

- [ ] Task 7: Install expo-apple-authentication (AC: 1,2,3,4)
  - `pnpm --filter @desert/mobile add expo-apple-authentication`

- [ ] Task 8: Add `apiAppleSignIn()` to `apps/mobile/src/api/auth.ts` (AC: 1,2)
  - POST to `/v1/auth/apple` with `{ identityToken, fullName }`
  - Follow same pattern as `apiGoogleSignIn`

- [ ] Task 9: Add `appleSignIn()` action to `apps/mobile/src/store/auth.store.ts` (AC: 1,2)
  - Accepts `identityToken: string` and `fullName` (nullable), calls `apiAppleSignIn`
  - Follow same pattern as `googleSignIn()` action

- [ ] Task 10: Create `apps/mobile/src/components/AppleSignInButton.tsx` (AC: 1,2,3,4,5)
  - iOS only — render nothing on Android (use `isAvailableAsync()` check)
  - Uses the native `AppleAuthentication.AppleAuthenticationButton` component (required for App Store compliance)
  - Requests `FULL_NAME` and `EMAIL` scopes
  - On `ERR_REQUEST_CANCELED`: silent no-op (user cancelled)
  - See Dev Notes for full implementation

- [ ] Task 11: Add AppleSignInButton to login and register screens (AC: 1,3,4,5)
  - Add below the Google button in `apps/mobile/app/(auth)/login.tsx`
  - Add below the Google button in `apps/mobile/app/(auth)/register.tsx`
  - No additional divider needed — button sits directly below Google button

### Phase 5 — i18n: Add Apple error strings

- [ ] Task 12: Update i18n locale files (AC: 6)
  - Add `invalidAppleToken` key to `auth.common` in `en.ts`, `pl.ts`, `uk.ts`

### Phase 6 — .env.example update

- [ ] Task 13: Update `apps/api/.env.example` with Apple bundle ID var

## Dev Notes

### Architecture: How Apple Sign-In Works in This Stack

```
Mobile (expo-apple-authentication — iOS only)
  → AppleAuthenticationButton.onPress triggers Apple native UI
  → Apple returns credential: { identityToken, fullName, email (first sign-in only) }
  → Mobile sends identityToken + fullName to POST /v1/auth/apple

API (NestJS)
  → Verifies identityToken with apple-signin-auth (fetches Apple public keys, validates JWT)
  → Extracts: payload.sub (Apple user ID), payload.email
  → ThirdParty.manuallyCreateOrUpdateUser('public', 'apple', sub, email, true)
  → If new user: CREATE User record (display_name from fullName param — first sign-in only)
  → If existing user: FIND User record (WHERE supertokens_id = stUser.id)
  → Session.createNewSessionWithoutRequestResponse → returns accessToken
```

**ThirdParty recipe is already initialized in `supertokens.ts` (Story 1.2) — no changes needed.**

---

### CRITICAL: Apple Only Sends Name + Email on First Sign-In

Apple's identity token (`identityToken`) always contains the `email` claim (the real or relay email). However, the user's **name** (`fullName`) is only provided by the native SDK on the **very first authorization**. On every subsequent sign-in, `credential.fullName` will be `null`.

**Strategy:**
- Mobile always sends `fullName` from the credential (will be null on repeat sign-ins)
- Backend checks `createdNewRecipeUser` — if `true`, build `display_name` from `fullName`
- If `createdNewRecipeUser = false` (returning user), ignore `fullName` entirely — it will be null anyway

---

### CRITICAL: Cannot Test in Expo Go

In Expo Go, Apple's identity token has `aud: "host.exp.Exponent"` (Expo's bundle ID), not `com.desert.app`. Backend verification will fail because the audience doesn't match. **Apple Sign-In must be tested on a development build or TestFlight.** This is expected and not a bug.

For local development without a dev build, unit tests are the primary verification path.

---

### app.json Change (Task 1)

```json
{
  "expo": {
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.desert.app",
      "usesAppleSignIn": true
    }
  }
}
```

---

### API: AppleAuthDto — `apps/api/src/auth/dto/apple-auth.dto.ts`

```ts
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class AppleAuthDto {
  @IsString()
  @IsNotEmpty()
  identityToken!: string;

  @IsOptional()
  @IsObject()
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  } | null;
}
```

---

### API: AuthService.appleSignIn() — Full Implementation

```ts
import appleSignin from 'apple-signin-auth';

// Add to AuthService class:
async appleSignIn(
  identityToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
) {
  // 1. Verify Apple identity token
  let applePayload: { sub: string; email?: string };
  try {
    applePayload = await appleSignin.verifyIdToken(identityToken, {
      audience: process.env['APPLE_APP_BUNDLE_ID'] ?? 'com.desert.app',
      ignoreExpiration: false,
    }) as { sub: string; email?: string };
  } catch {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'INVALID_APPLE_TOKEN',
      message: 'Invalid Apple identity token',
    });
  }

  if (!applePayload.email) {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'APPLE_EMAIL_MISSING',
      message: 'Apple account has no email address',
    });
  }

  // 2. Create or find SuperTokens ThirdParty user
  const result = await ThirdParty.manuallyCreateOrUpdateUser(
    'public',
    'apple',
    applePayload.sub,      // stable Apple user ID — never changes
    applePayload.email,
    true,                  // Apple emails are pre-verified
    undefined,
    {},
  );

  if (result.status === 'SIGN_IN_UP_NOT_ALLOWED') {
    throw new ConflictException({
      statusCode: 409,
      error: 'SOCIAL_EMAIL_CONFLICT',
      message: result.reason,
    });
  }

  if (result.status !== 'OK') {
    throw new Error(`SuperTokens Apple signInUp failed: ${result.status}`);
  }

  const { user: stUser, recipeUserId, createdNewRecipeUser } = result;

  // 3. Find or create our User record
  let user;
  if (createdNewRecipeUser) {
    // First sign-in — fullName available now, never again
    const displayName = [fullName?.givenName, fullName?.familyName]
      .filter(Boolean)
      .join(' ') || null;

    user = await this.prisma.user.create({
      data: {
        supertokens_id: stUser.id,
        email: applePayload.email,
        display_name: displayName,
        role: 'DRIVER',
      },
    });
  } else {
    user = await this.prisma.user.findUniqueOrThrow({
      where: { supertokens_id: stUser.id },
    });
  }

  // 4. Create SuperTokens session
  const session = await Session.createNewSessionWithoutRequestResponse(
    'public',
    recipeUserId,
    { userId: user.id, role: user.role },
  );

  return { user, accessToken: session.getAccessToken() };
}
```

**Import:** `import appleSignin from 'apple-signin-auth';`

Note: `apple-signin-auth` fetches Apple's public JWKS from `https://appleid.apple.com/auth/keys` and caches them. No Apple private key or Team ID is needed for token verification.

---

### API: AuthController — Add POST /v1/auth/apple

```ts
@Post('apple')
@HttpCode(200)
appleAuth(@Body() dto: AppleAuthDto) {
  return this.authService.appleSignIn(dto.identityToken, dto.fullName);
}
```

Import `AppleAuthDto` from `'./dto/apple-auth.dto.js'`.

---

### Mobile: AppleSignInButton — `apps/mobile/src/components/AppleSignInButton.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '../store/auth.store';
import { ApiError } from '../api/auth';

interface Props {
  onError?: (code: string) => void;
}

export function AppleSignInButton({ onError }: Props) {
  const auth = useAuth();
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      AppleAuthentication.isAvailableAsync().then(setIsAvailable);
    }
  }, []);

  if (!isAvailable) return null;

  async function handlePress() {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) return;

      await auth.appleSignIn(credential.identityToken, credential.fullName);
    } catch (err: unknown) {
      const error = err as { code?: string };
      if (error.code === 'ERR_REQUEST_CANCELED') return; // user cancelled — no-op
      const code = err instanceof ApiError ? err.error : 'UNKNOWN_ERROR';
      onError?.(code);
    }
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={8}
      style={{ height: 48, marginBottom: 16 }}
      onPress={handlePress}
    />
  );
}
```

**Why the native `AppleAuthenticationButton`:** Apple's App Store guidelines require Sign in with Apple buttons to follow Apple's design specifications. The native component automatically handles this, renders in the system language, and meets all compliance requirements.

**Why `isAvailableAsync()`:** More defensive than `Platform.OS === 'ios'` alone — returns `false` on iOS < 13 (where Sign in with Apple is not available). On Android it is unavailable (the import exists but always returns false).

---

### Mobile: Auth API Client — Add to `apps/mobile/src/api/auth.ts`

```ts
export async function apiAppleSignIn(
  identityToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
): Promise<AuthResponse> {
  return request<AuthResponse>('/v1/auth/apple', {
    method: 'POST',
    body: JSON.stringify({ identityToken, fullName }),
  });
}
```

---

### Mobile: Auth Store — Add appleSignIn Action

Add to `AuthState` interface and `AuthProvider`:

```ts
// In AuthState interface:
appleSignIn: (
  identityToken: string,
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
) => Promise<void>;

// In AuthProvider (useCallback):
const appleSignIn = useCallback(
  async (
    identityToken: string,
    fullName?: { givenName?: string | null; familyName?: string | null } | null,
  ) => {
    const res = await apiAppleSignIn(identityToken, fullName);
    await saveToken(res.accessToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
  },
  [],
);
```

Add `appleSignIn` to the context value in `React.createElement(AuthContext.Provider, { value: { ..., appleSignIn, ... } })`.

---

### i18n Keys to Add

Add `invalidAppleToken` and `appleEmailMissing` to the `auth.common` namespace (already exists from Story 1.2):

```ts
// en.ts — add to auth.common:
invalidAppleToken: 'Apple sign-in failed. Please try again.',
appleEmailMissing: 'Your Apple account has no email address. Please use email sign-in.',
```

```ts
// pl.ts — add to auth.common:
invalidAppleToken: 'Logowanie przez Apple nie powiodło się. Spróbuj ponownie.',
appleEmailMissing: 'Twoje konto Apple nie ma adresu e-mail. Użyj logowania przez e-mail.',
```

```ts
// uk.ts — add to auth.common:
invalidAppleToken: 'Не вдалося увійти через Apple. Спробуйте ще раз.',
appleEmailMissing: 'Ваш акаунт Apple не має email-адреси. Скористайтесь входом через email.',
```

---

### Environment Variables — New for Story 1.3

Add to `apps/api/.env.example`:
```
# Apple Sign-In (for token audience verification — Story 1.3)
APPLE_APP_BUNDLE_ID=com.desert.app
```

Add `APPLE_APP_BUNDLE_ID=com.desert.app` to Railway Variables.

Note: `apple-signin-auth` only needs the bundle ID for audience validation — no Apple private key or Team ID required for token verification.

---

### Machine-Readable Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_APPLE_TOKEN` | 401 | Apple identity token failed verification |
| `APPLE_EMAIL_MISSING` | 401 | Token has no email claim (rare) |
| `SOCIAL_EMAIL_CONFLICT` | 409 | Same email already exists via another recipe |

---

### Testing Standards

Mock pattern for `apple-signin-auth` (same `__esModule: true` requirement as other mocks):

```ts
const mockVerifyAppleToken = jest.fn();

jest.mock('apple-signin-auth', () => ({
  __esModule: true,
  default: {
    verifyIdToken: (...args: unknown[]) => mockVerifyAppleToken(...args),
  },
}));
```

`ThirdParty` mock is already in `auth.service.spec.ts` from Story 1.2 — no new mock needed.

Test cases:
```ts
// First sign-in with fullName:
mockVerifyAppleToken.mockResolvedValueOnce({ sub: 'apple-uid', email: 'user@example.com' });
mockManuallyCreateOrUpdateUser.mockResolvedValueOnce({
  status: 'OK', user: { id: 'st-apple-id' }, recipeUserId: {...}, createdNewRecipeUser: true,
});
// Assert prisma.user.create called with display_name: 'Jane Doe'

// Returning user (fullName null):
// createdNewRecipeUser: false → prisma.user.findUniqueOrThrow called

// Invalid token:
mockVerifyAppleToken.mockRejectedValueOnce(new Error('bad token'));
// Assert throws UnauthorizedException

// SIGN_IN_UP_NOT_ALLOWED:
// Assert throws ConflictException with SOCIAL_EMAIL_CONFLICT
```

---

### Previous Story Learnings (from Stories 1.1 + 1.2)

- **`__esModule: true` in mock factories is mandatory** for all supertokens and third-party mocks
- **Import paths use `.js` extension** in NestJS (`apple-signin-auth` is a CommonJS package — import as `import appleSignin from 'apple-signin-auth'`)
- **ThirdParty recipe is already in recipeList** — `supertokens.ts` does NOT need to be modified in this story
- **`supertokens_id = stUser.id`** (primary user UUID), `recipeUserId` passed to session
- **NestJS `.js` extension** in all relative imports
- **`google-auth-library` mock uses `OAuth2Client` class pattern** — `apple-signin-auth` uses a simpler default export pattern (see mock above)

---

### Project Structure Notes

- New files: `apps/api/src/auth/dto/apple-auth.dto.ts`, `apps/mobile/src/components/AppleSignInButton.tsx`
- Modified: `auth.service.ts`, `auth.controller.ts`, `auth.service.spec.ts`, `auth.controller.spec.ts`, `apps/mobile/src/api/auth.ts`, `apps/mobile/src/store/auth.store.ts`, `apps/mobile/app/(auth)/login.tsx`, `apps/mobile/app/(auth)/register.tsx`, locale files, `app.json`, `.env.example`
- `supertokens.ts` — NOT modified (ThirdParty already initialized in Story 1.2)

### References

- [Source: epics.md — Story 1.3]
- [Source: architecture.md — Decision 3: Authentication & RBAC]
- [Source: apps/api/src/auth/auth.service.ts — googleSignIn() pattern to follow]
- [Source: apps/mobile/src/components/GoogleSignInButton.tsx — pattern reference]
- [Source: apps/mobile/app.json — scheme: "desert", bundleIdentifier: "com.desert.app"]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Completion Notes List

_To be filled by dev agent during implementation_

### File List

_To be filled by dev agent during implementation_

## Review Patches (2026-04-04)

### P-3 Applied — INVALID_APPLE_TOKEN and APPLE_EMAIL_MISSING unhandled in login/register screens
`apps/mobile/app/(auth)/login.tsx` and `register.tsx`: the shared `handleGoogleError` function (used for both Google and Apple button errors) was missing `INVALID_APPLE_TOKEN` and `APPLE_EMAIL_MISSING` cases — both would fall through to the generic "Invalid Google token" message. Added explicit cases mapping to `auth.common.invalidAppleToken` and `auth.common.appleEmailMissing` i18n keys (already present; `SoftSignUpSheet`/`SignUpGateSheet` already handled these correctly).

### P-3 Applied — AppleAuthDto.identityToken missing @MaxLength
`apps/api/src/auth/dto/apple-auth.dto.ts`: Added `@MaxLength(2048)` to `identityToken`, matching the same guard applied to `GoogleAuthDto` in Story 1.2 review. `MaxLength` was already imported for `FullNameDto` fields.

**Note:** Several higher-severity issues were already fixed in commit `8689ebb` prior to this review (hardcoded `com.desert.app` fallback removed, P2002 guard added, `identityToken` null → `onError` call, `@MaxLength` on fullName fields, user field leak fixed in 1.1 review).

## Review Deferred Items (2026-04-04)

- **D1**: `AppleSignInButton` and `GoogleSignInButton` share the same `onError` callback in login/register (`handleGoogleError`), which is a misleading function name. Cosmetic rename — no functional impact.
- **D2**: Apple `identityToken` is additionally bounded by Fastify's 1MB body limit — the `@MaxLength(2048)` is belt-and-suspenders.
