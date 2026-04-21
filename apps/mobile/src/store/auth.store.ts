import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiAppleSignIn, apiGetMe, apiGoogleSignIn, apiLogin, apiLogout, apiRefreshSession, apiRegister, type AuthResponse, type AuthUser } from '../api/auth';
import { deleteRefreshToken, deleteToken, getRefreshToken, getToken, saveRefreshToken, saveToken } from '../lib/secure-storage';

const ONBOARDING_KEY = 'desert:hasSeenOnboarding';

// TODO (Story 1.4): No mobile test infra exists yet. Guest mode logic
// (skipOnboarding, hasSeenOnboarding restore, isGuest derivation) should be
// covered by unit tests once @testing-library/react-native is set up.

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isGuest: boolean;
  hasSeenOnboarding: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  googleSignIn: (idToken: string) => Promise<void>;
  appleSignIn: (
    identityToken: string,
    fullName?: { givenName?: string | null; familyName?: string | null } | null,
  ) => Promise<void>;
  skipOnboarding: () => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Exchanges the stored refresh token for a fresh access token. Returns the new
   * access token on success, or null if no refresh token exists / refresh failed —
   * callers should treat null as "re-login required".
   * Safe to call concurrently; de-duped via an in-flight promise.
   */
  refreshSession: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  // isGuest: seen onboarding (skipped) but not authenticated
  const isGuest = hasSeenOnboarding && accessToken === null;

  // Restore session and onboarding state on mount
  useEffect(() => {
    async function restoreSession() {
      // Restore onboarding flag
      const onboarded = await AsyncStorage.getItem(ONBOARDING_KEY);
      if (onboarded === 'true') {
        setHasSeenOnboarding(true);
      }

      // Restore auth token
      const token = await getToken();
      if (token === null) return;

      try {
        const me = await apiGetMe(token);
        setAccessToken(token);
        setUser(me);
      } catch {
        // Token expired or invalid — clear silently
        await deleteToken();
      }
    }

    restoreSession().finally(() => setIsLoading(false));
  }, []);

  // Mark onboarding as seen on any successful sign-in so the SoftSignUpSheet
  // is never shown again, even if the user later logs out.
  const markOnboardingSeen = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
  }, []);

  const persistSession = useCallback(async (res: AuthResponse) => {
    await saveToken(res.accessToken);
    if (res.refreshToken) {
      await saveRefreshToken(res.refreshToken);
    } else {
      await deleteRefreshToken();
    }
    await markOnboardingSeen();
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, [markOnboardingSeen]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    await persistSession(res);
  }, [persistSession]);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await apiRegister(email, password, displayName);
      await persistSession(res);
    },
    [persistSession],
  );

  const googleSignIn = useCallback(async (idToken: string) => {
    const res = await apiGoogleSignIn(idToken);
    await persistSession(res);
  }, [persistSession]);

  const appleSignIn = useCallback(
    async (
      identityToken: string,
      fullName?: { givenName?: string | null; familyName?: string | null } | null,
    ) => {
      const res = await apiAppleSignIn(identityToken, fullName);
      await persistSession(res);
    },
    [persistSession],
  );

  const skipOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
  }, []);

  const logout = useCallback(async () => {
    if (accessToken) {
      try {
        await apiLogout(accessToken);
      } catch {
        // best-effort — clear local state regardless
      }
    }
    await deleteToken();
    await deleteRefreshToken();
    setAccessToken(null);
    setUser(null);
  }, [accessToken]);

  // De-dup concurrent refreshes — if queue processor + Activity screen both hit a
  // 401 at once we only want ONE /v1/auth/refresh roundtrip.
  const refreshInFlight = React.useRef<Promise<string | null> | null>(null);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;

    const run = (async () => {
      const stored = await getRefreshToken();
      if (!stored) return null;
      try {
        const res = await apiRefreshSession(stored);
        await saveToken(res.accessToken);
        await saveRefreshToken(res.refreshToken);
        setAccessToken(res.accessToken);
        return res.accessToken;
      } catch (err) {
        // Only wipe tokens when the server definitively says the refresh token
        // itself is invalid (401). For 5xx / network errors the refresh token
        // is still potentially valid — keep it so a later retry can succeed
        // rather than forcing the user to re-login after a transient outage.
        if (err instanceof ApiError && err.statusCode === 401) {
          await deleteToken();
          await deleteRefreshToken();
          setAccessToken(null);
          setUser(null);
        }
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = run;
    return run;
  }, []);

  // Register this store's refreshSession as the module-level singleton so non-React
  // callers (e.g. queueProcessor) can drive a refresh through the same in-flight
  // de-dup without reaching into React context.
  useEffect(() => {
    _moduleRefreshSession = refreshSession;
    return () => {
      if (_moduleRefreshSession === refreshSession) _moduleRefreshSession = null;
    };
  }, [refreshSession]);

  return React.createElement(AuthContext.Provider, {
    value: {
      user,
      accessToken,
      isLoading,
      isGuest,
      hasSeenOnboarding,
      login,
      register,
      googleSignIn,
      appleSignIn,
      skipOnboarding,
      logout,
      refreshSession,
    },
    children,
  });
}

// Module-level accessor for non-React callers (queue processor, background tasks)
// that need to trigger a session refresh. Populated by AuthProvider on mount.
let _moduleRefreshSession: (() => Promise<string | null>) | null = null;

/**
 * Ask the live AuthProvider to refresh the SuperTokens session.
 * Returns the new access token, or null if no refresh token exists / refresh failed.
 * Safe to call from the queue processor — de-duped with React-land refresh calls.
 */
export async function refreshSessionFromModule(): Promise<string | null> {
  if (!_moduleRefreshSession) return null;
  return _moduleRefreshSession();
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
