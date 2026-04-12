# Story 1.2b: Migrate Google Sign-In to Native SDK

## Context

The current Google Sign-In implementation uses `expo-auth-session` with a browser-based OAuth flow (Chrome Custom Tab). This has multiple issues:
1. The Expo auth proxy (`auth.expo.io`) is deprecated in SDK 50+ and fails to redirect back to standalone builds
2. `WebBrowser.maybeCompleteAuthSession()` crashes on Xiaomi devices when loaded at module scope
3. The browser-based flow is a poor UX compared to the native Google account picker

## Task

Replace `expo-auth-session/providers/google` with `@react-native-google-signin/google-signin` for native Google Sign-In on Android (and iOS when configured).

## Implementation

1. Install `@react-native-google-signin/google-signin`
2. Add Expo config plugin to `app.json`
3. Rewrite `GoogleSignInButton.tsx` to use the native SDK
4. Configure with `webClientId` (the ID token audience the backend expects)
5. The backend `/v1/auth/google` endpoint already verifies Google ID tokens — no backend changes needed

## Key Details

- **Web Client ID:** `481368978057-9skd9qo5al694f7b31k016u77v7ofq9o.apps.googleusercontent.com` — passed as `webClientId` to the native SDK so the returned ID token has the correct audience for backend verification
- **Android Client ID:** Not passed to the SDK directly — Google Play Services uses the package name (`com.litro.app`) + SHA-1 fingerprint to verify the app natively
- **Backend:** No changes needed — `auth.service.ts` already verifies ID tokens via `google-auth-library`

## Acceptance Criteria

**Given** a user is on the login or register screen
**When** they tap "Continue with Google"
**Then** the native Google account picker appears (not a browser)
**And** after selecting an account, they are signed in and redirected to the app

**Given** Google client IDs are not configured (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset)
**When** the login screen renders
**Then** the Google button is not shown (existing GOOGLE_CONFIGURED guard)
**And** no native modules are loaded (no Xiaomi crash)
