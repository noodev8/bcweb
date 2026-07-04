'use client';
/*
=======================================================================================================================================
Module: src/contexts/AuthContext.tsx
=======================================================================================================================================
Purpose: Holds the logged-in user (display_name) + JWT for the whole web app and guards routes (CLAUDE.md). The token is persisted in
         localStorage (via src/lib/api.ts helpers) so a refresh keeps you logged in until the JWT expires. On a 401-style outcome
         (UNAUTHORIZED / expired session) any page can call logout() to clear state and bounce to /login.

Design: a thin context. login() calls the API client and, on SUCCESS, stores the token + display_name. We intentionally do NOT
        decode the JWT on the client (it only carries an id anyway, per API-RULES); the display_name comes straight from the login
        response. `ready` flags that we've finished reading localStorage so guards don't flash-redirect during hydration.
=======================================================================================================================================
*/

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { login as apiLogin, getToken, setToken, clearToken } from '@/lib/api';

interface AuthState {
  displayName: string | null;
  ready: boolean;                       // true once we've hydrated auth from localStorage
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const DISPLAY_KEY = 'bc_display_name';

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Hydrate from localStorage once on mount. If a token exists we treat the user as logged in (the server will reject an expired
  // token on the next call, at which point pages call logout()).
  useEffect(() => {
    const token = getToken();
    const name = typeof window !== 'undefined' ? window.localStorage.getItem(DISPLAY_KEY) : null;
    if (token && name) setDisplayName(name);
    setReady(true);
  }, []);

  async function login(username: string, password: string) {
    const result = await apiLogin(username, password);
    if (result.success && result.data) {
      setToken(result.data.token);
      window.localStorage.setItem(DISPLAY_KEY, result.data.display_name);
      setDisplayName(result.data.display_name);
      return { success: true };
    }
    // API-level failure (e.g. INVALID_CREDENTIALS) — surfaced to the caller, never thrown.
    return { success: false, error: result.error || 'Login failed' };
  }

  function logout() {
    clearToken();
    if (typeof window !== 'undefined') window.localStorage.removeItem(DISPLAY_KEY);
    setDisplayName(null);
    router.replace('/login');
  }

  const value: AuthState = {
    displayName,
    ready,
    isAuthenticated: !!displayName,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
