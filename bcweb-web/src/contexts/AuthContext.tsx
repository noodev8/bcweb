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

ADMIN vs NOT ADMIN (owner, 2026-11-20): `isAdmin` decides which screens show (lib/userAccess.ts). It comes from GET /me on each page
        load, so a switch on the Users screen applies on that person's next page load without a new login. The last answer is kept in
        localStorage (written at login and by every /me) so a page doesn't wait on /me to draw. null = not known yet (AppShell shows
        Loading). Hidden on screen only — the API refuses nothing on it.
=======================================================================================================================================
*/

import { createContext, useContext, useSyncExternalStore, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { login as apiLogin, getMe, getToken, setToken, clearToken, type MeData } from '@/lib/api';

interface AuthState {
  displayName: string | null;
  ready: boolean;                       // true once we've hydrated auth from localStorage
  isAuthenticated: boolean;
  isAdmin: boolean | null;              // null = not known yet (first visit before /me answers). false = the five screens only.
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const DISPLAY_KEY = 'bc_display_name';
const ADMIN_KEY = 'bc_is_admin';        // '1' | '0' — the last known answer, so pages draw before /me returns

const AuthContext = createContext<AuthState | undefined>(undefined);

// ---------------------------------------------------------------------------------------------------------------------------------
// localStorage is an EXTERNAL STORE, so it is read with useSyncExternalStore rather than copied into state by a mount effect.
//
// Why the change: the old shape was `useState(null)` + `useEffect(() => setDisplayName(...))`, which is the pattern
// react-hooks/set-state-in-effect flags — and for a real reason here. It renders once logged-out, throws that away, then renders
// again logged-in, so anything auth-dependent could flash the wrong state for a frame. Reading localStorage during render instead
// would be worse (a hydration mismatch, since the server has no localStorage). useSyncExternalStore is the API that solves exactly
// this: getServerSnapshot is used for SSR and hydration, getSnapshot immediately after, and React handles the switch.
//
// A bonus that falls out of it: because the store is event-driven, logging out in ONE TAB now updates every other open tab (the
// 'storage' event fires cross-tab). The old copy-into-state version could not see that.
// ---------------------------------------------------------------------------------------------------------------------------------
const AUTH_EVENT = 'bc-auth-change';

// Same-tab writes don't fire 'storage' (the browser only notifies OTHER tabs), so login/logout announce themselves explicitly.
function announceAuthChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EVENT));
}

function subscribeToAuth(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(AUTH_EVENT, onChange);   // this tab
  window.addEventListener('storage', onChange);    // other tabs
  return () => {
    window.removeEventListener(AUTH_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

// Returns a STRING or null — a primitive, so React's identity check is stable and this can't loop. Never build an object here.
function getDisplayNameSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  const token = getToken();
  const name = window.localStorage.getItem(DISPLAY_KEY);
  // A token present means "logged in as far as we know"; the server rejects an expired one on the next call, and pages call logout().
  return token && name ? name : null;
}

// The cached admin flag — a primitive again ('1' | '0' | null).
function getAdminSnapshot(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ADMIN_KEY);
}

function storeAdmin(isAdmin: boolean): void {
  if (typeof window === 'undefined') return;
  const v = isAdmin ? '1' : '0';
  if (window.localStorage.getItem(ADMIN_KEY) === v) return;   // unchanged — no event, no re-render
  window.localStorage.setItem(ADMIN_KEY, v);
  announceAuthChange();
}

// `ready` means "past hydration, so localStorage has actually been consulted" — it exists so route guards don't flash-redirect before
// we know. false on the server and during the hydration render, true immediately after, with no effect and no setState.
const NEVER_CHANGES = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const displayName = useSyncExternalStore(subscribeToAuth, getDisplayNameSnapshot, () => null);
  const ready = useSyncExternalStore(NEVER_CHANGES, () => true, () => false);
  const cachedAdmin = useSyncExternalStore(subscribeToAuth, getAdminSnapshot, () => null);

  // GET /me once per page load (and again after a new login — the token is in the key, so one user's answer is never reused for
  // another's). useSWR directly, not useApiQuery: that hook calls useAuth(), which isn't available inside the provider itself.
  const token = displayName ? getToken() : null;
  const me = useSWR<MeData>(
    token ? ['auth-me', token] : null,
    async () => {
      const res = await getMe();
      if (res.success && res.data) {
        storeAdmin(res.data.is_admin);
        return res.data;
      }
      if (res.return_code === 'UNAUTHORIZED') logout();
      throw new Error(res.error || 'Could not read who is signed in');
    },
    { revalidateOnFocus: false, errorRetryCount: 2 },
  );
  // /me's answer, else the last known one. If /me fails with nothing cached, the narrower view (the five screens) rather than a page
  // stuck on Loading.
  const isAdmin: boolean | null = me.data ? me.data.is_admin
    : cachedAdmin === '1' ? true : cachedAdmin === '0' ? false
      : me.error ? false : null;

  async function login(username: string, password: string) {
    const result = await apiLogin(username, password);
    if (result.success && result.data) {
      setToken(result.data.token);
      window.localStorage.setItem(DISPLAY_KEY, result.data.display_name);
      window.localStorage.setItem(ADMIN_KEY, result.data.is_admin ? '1' : '0');
      announceAuthChange();
      return { success: true };
    }
    // API-level failure (e.g. INVALID_CREDENTIALS) — surfaced to the caller, never thrown.
    return { success: false, error: result.error || 'Login failed' };
  }

  function logout() {
    clearToken();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DISPLAY_KEY);
      window.localStorage.removeItem(ADMIN_KEY);
    }
    announceAuthChange();
    router.replace('/login');
  }

  const value: AuthState = {
    displayName,
    ready,
    isAuthenticated: !!displayName,
    isAdmin: displayName ? isAdmin : null,
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
