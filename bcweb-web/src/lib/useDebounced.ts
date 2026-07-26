'use client';
/*
=======================================================================================================================================
Module: src/lib/useDebounced.ts
=======================================================================================================================================
Purpose: Trail a fast-changing value (a keystroke-by-keystroke input) by a fixed delay, so it can be used as a fetch key without firing
         a request per character.

Why this is allowed to use an effect when the rest of the codebase moved away from it: react-hooks/set-state-in-effect objects to
setState called SYNCHRONOUSLY in an effect body, because that renders, throws the result away and renders again. Here the setState
happens inside a setTimeout callback — a later tick, i.e. exactly the "subscribe to something outside React and write back when it
fires" case effects are FOR. The timer is the external system. So this is the correct shape, not a loophole.

Pair it with a null useApiQuery key to get "search as you type" with no request until the typing settles:
    const debounced = useDebounced(term.trim(), 400);
    const { data } = useApiQuery(debounced ? ['thing', debounced] : null, () => findThing(debounced));
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    // Every new value cancels the pending one, so only the last value in a burst ever lands.
    return () => clearTimeout(t);
  }, [value, ms]);

  return settled;
}
