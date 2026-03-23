import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiGetMe, apiGoogleSignIn, apiLogin, apiLogout, apiRegister, type AuthUser } from '../api/auth';
import { deleteToken, getToken, saveToken } from '../lib/secure-storage';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  googleSignIn: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore and validate session on mount
  useEffect(() => {
    async function restoreSession() {
      const token = await getToken();
      if (token === null) return;

      try {
        // Validate the stored token is still accepted by the server
        const me = await apiGetMe(token);
        setAccessToken(token);
        setUser(me);
      } catch {
        // Token is expired or invalid — clear it silently
        await deleteToken();
      }
    }

    restoreSession().finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    await saveToken(res.accessToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await apiRegister(email, password, displayName);
      await saveToken(res.accessToken);
      setAccessToken(res.accessToken);
      setUser(res.user);
    },
    [],
  );

  const googleSignIn = useCallback(async (idToken: string) => {
    const res = await apiGoogleSignIn(idToken);
    await saveToken(res.accessToken);
    setAccessToken(res.accessToken);
    setUser(res.user);
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
    value: { user, accessToken, isLoading, login, register, googleSignIn, logout },
    children,
  });
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
