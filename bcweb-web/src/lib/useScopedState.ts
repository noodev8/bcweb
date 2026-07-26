'use client';
/*
=======================================================================================================================================
Module: src/lib/useScopedState.ts
=======================================================================================================================================
Purpose: State that belongs to a SCOPE and resets itself when the scope changes — the pure replacement for the very common
             useEffect(() => { setSelected(new Set()); setError(null); }, [mode, segment]);
         reset-on-dependency-change pattern.

Why not just keep the effect: calling setState synchronously inside an effect makes React render, throw the result away, and render
again (react-hooks/set-state-in-effect). The user can see that as a flash of the OLD scope's state — briefly showing the previous
segment's ticked rows before they clear. Deriving the reset during render instead means the new scope is correct on the FIRST render;
there is no intermediate frame to see.

How it works: the scope is stored ALONGSIDE the value. When the scope you pass in no longer matches the stored one, the stored value
is simply ignored and `initial` is handed back — no write, no extra render. The next write re-stamps the current scope.

IMPORTANT: `initial` must be a STABLE reference — a primitive (null, 0, ''), or a module-level constant for objects/Sets/arrays.
Passing a fresh `new Set()` on every render would hand back a new identity on every out-of-scope render, which defeats any useMemo
that depends on it (exactly the bug the NO_ROWS constants elsewhere exist to avoid). Values are treated as immutable: replace them,
never mutate in place.
=======================================================================================================================================
*/

import { useCallback, useState } from 'react';

export function useScopedState<T>(
  scope: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [held, setHeld] = useState<{ scope: string; value: T }>({ scope, value: initial });

  // Out of scope => the stored value belongs to something else, so it simply doesn't count.
  const value = held.scope === scope ? held.value : initial;

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setHeld((prev) => {
        // An updater must build on the value for the CURRENT scope, not on a leftover from the previous one.
        const base = prev.scope === scope ? prev.value : initial;
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(base) : next;
        return { scope, value: resolved };
      });
    },
    [scope, initial],
  );

  return [value, set];
}
