import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiAppleSignIn, apiGetMe, apiGoogleSignIn, apiLogin, apiLogout, apiRegister, type AuthUser } from '../api/auth';
import { deleteToken, getToken, saveToken } from '../lib/secure-storage';

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

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    await saveToken(res.accessToken);
    await markOnboardingSeen();
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, [markOnboardingSeen]);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await apiRegister(email, password, displayName);
      await saveToken(res.accessToken);
      await markOnboardingSeen();
      setAccessToken(res.accessToken);
      setUser(res.user);
    },
    [markOnboardingSeen],
  );

  const googleSignIn = useCallback(async (idToken: string) => {
    const res = await apiGoogleSignIn(idToken);
    await saveToken(res.accessToken);
    await markOnboardingSeen();
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, [markOnboardingSeen]);

  const appleSignIn = useCallback(
    async (
      identityToken: string,
      fullName?: { givenName?: string | null; familyName?: string | null } | null,
    ) => {
      const res = await apiAppleSignIn(identityToken, fullName);
      await saveToken(res.accessToken);
      await markOnboardingSeen();
      setAccessToken(res.accessToken);
      setUser(res.user);
    },
    [markOnboardingSeen],
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
    setAccessToken(null);
    setUser(null);
  }, [accessToken]);

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
    },
    children,
  });
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
