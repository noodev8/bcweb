'use client';
/*
=======================================================================================================================================
Module: src/lib/useApiQuery.ts
=======================================================================================================================================
Purpose: One hook for every "load data from the API and render it" screen. Replaces the hand-rolled
         `useState(rows) + useState(loading) + useState(error) + useCallback(load) + useEffect(() => { load(); })`
         quartet that every module page used to carry.

Why it exists (three real problems it removes, not just tidiness):
  1. UNAUTHORIZED handling was copy-pasted into every single loader (`if (res.return_code === 'UNAUTHORIZED') { logout(); return; }`).
     One missed copy = a silently stuck screen on an expired JWT. It now happens in exactly one place, here.
  2. `src/lib/api.ts` deliberately NEVER THROWS on API-level errors (API-RULES: every response is HTTP 200 + a return_code, so the
     client returns an ApiResult envelope instead). SWR is the opposite — it decides "error" by catching a throw. This hook is the
     adapter between those two contracts, so no page has to think about it.
  3. The loading/error state machine was re-implemented per page and drifted (some set loading on refetch, some didn't).

Design notes that matter:
  - `key === null` means DO NOT FETCH YET. That replaces the `if (!groupid) return;` guard clauses that used to sit at the top of
    loaders, and it's why those guards disappear from the migrated pages rather than moving somewhere else.
  - The key is what SWR caches and dedupes on, so it must contain every input the fetcher reads (segment, mode, search term...).
    Get this wrong and you get a stale screen — it is the one genuinely error-prone part of using this hook.
  - REVALIDATION IS DELIBERATELY CONSERVATIVE. `revalidateOnFocus` is OFF. The API points at the LIVE production database
    (CLAUDE.md), and these are heavy aggregate queries over skusummary/localstock — refetching every list the moment someone
    alt-tabs back would put real, pointless load on the DB the owner's Python scripts also use. Opt in per call site if a screen
    genuinely wants it.
  - `isLoading` is SWR's "first load, nothing cached yet". `busy` additionally covers background revalidation, which is what the old
    per-page `loading` flag effectively meant after an action (apply a price -> refetch -> spinner). Use `busy` where the old code
    showed a spinner on refetch; use `isLoading` for the initial skeleton only.
  - Errors do NOT retry on UNAUTHORIZED. Retrying would call logout() repeatedly and fight the redirect to /login.
=======================================================================================================================================
*/

import useSWR, { type Key, type SWRConfiguration } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import type { ApiResult } from '@/lib/api';

// Carries the envelope's return_code alongside the message, so a call site can still branch on a specific code (e.g. NOT_FOUND)
// the way it used to branch on `res.return_code`.
export class ApiError extends Error {
  readonly return_code: string;
  constructor(message: string, return_code: string) {
    super(message);
    this.name = 'ApiError';
    this.return_code = return_code;
  }
}

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: ApiError | undefined;
  isLoading: boolean;   // first load, no cached data yet — for the initial skeleton
  busy: boolean;        // first load OR a background revalidate — matches the old per-page `loading` flag
  /** Refetch this key. Await it if you need the fresh data before doing something else. */
  refresh: () => Promise<T | undefined>;
  /** Write to the cache directly (optimistic updates). Same signature as SWR's mutate. */
  mutate: ReturnType<typeof useSWR<T, ApiError>>['mutate'];
}

/**
 * Fetch `run()` and keep it in SWR's cache under `key`.
 *
 * @param key   SWR cache key — MUST include every value `run` depends on. Pass `null` to hold off fetching entirely.
 * @param run   Any api.ts client function call. Returns an ApiResult envelope; this hook unwraps it.
 */
export function useApiQuery<T>(
  key: Key,
  run: () => Promise<ApiResult<T>>,
  options?: SWRConfiguration<T, ApiError>,
): UseApiQueryResult<T> {
  const { logout } = useAuth();

  const swr = useSWR<T, ApiError>(
    key,
    async () => {
      const res = await run();
      if (res.success && res.data !== undefined) return res.data;

      // Expired / missing JWT. Bounce to login once — and throw so SWR records an error rather than caching `undefined` as success.
      if (res.return_code === 'UNAUTHORIZED') {
        logout();
        throw new ApiError('Your session has expired — please sign in again.', 'UNAUTHORIZED');
      }
      throw new ApiError(res.error || 'Request failed', res.return_code || 'UNKNOWN');
    },
    {
      revalidateOnFocus: false,      // see header note — live production DB, heavy aggregate queries
      shouldRetryOnError: true,
      errorRetryCount: 2,
      onErrorRetry: (err, swrKey, config, revalidate, revalidateOpts) => {
        // Never retry an auth failure; logout() has already redirected and retrying just fights it.
        if ((err as ApiError)?.return_code === 'UNAUTHORIZED') return;
        if ((revalidateOpts.retryCount ?? 0) >= (config.errorRetryCount ?? 2)) return;
        setTimeout(() => revalidate(revalidateOpts), 3000 * (revalidateOpts.retryCount ?? 1));
      },
      ...options,
    },
  );

  return {
    data: swr.data,
    error: swr.error,
    isLoading: swr.isLoading,
    busy: swr.isLoading || swr.isValidating,
    refresh: () => swr.mutate(),
    mutate: swr.mutate,
  };
}
