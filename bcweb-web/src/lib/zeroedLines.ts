/*
=======================================================================================================================================
Module: src/lib/zeroedLines.ts
=======================================================================================================================================
Purpose: Keep an order line ON SCREEN after "−" has walked it down to zero, instead of letting it vanish out of the list.

Why: `orderstatus` holds one row per physical unit, so the last "−" deletes the final row and the line simply isn't in the next fetch —
the row disappears mid-click, the rows below jump up, and the operator loses the place they were working (owner: "feels jerky",
2026-07-22). The data is right; the disappearance is the problem. So the component remembers a line that just hit 0, and re-inserts it
into the fresh server list at the position it held, showing qty 0. It is a display-only ghost: the units really are archived, and the
line goes for good on the next full page load.

The ghost also carries the `ordernums` that adjust-qty archived, which is what makes its "+" work — at zero there is no surviving row
for the add path to clone, so "+" restores those exact rows via POST /order-status-restore (same batch, orderdate, ponumber, arrived
state). Without that the operator could walk a line to zero and have no way back.

Used by both halves of the Order Status page (TO PLACE sheet, ON ORDER batch lines), which hold different row shapes — hence generic.
=======================================================================================================================================
*/

import { useCallback, useState } from 'react';

export interface Zeroed<T> {
  payload: T;         // the row/group exactly as it should render at qty 0
  index: number;      // where it sat in the list, so it re-appears in place rather than at the end
  removed: string[];  // the archived ordernums "+" will restore
}

export function useZeroedLines<T>() {
  const [zeroed, setZeroed] = useState<Map<string, Zeroed<T>>>(() => new Map());

  const remember = useCallback((key: string, z: Zeroed<T>) => {
    setZeroed((prev) => new Map(prev).set(key, z));
  }, []);

  // Called whenever a line is no longer at zero (restored, or re-added by any other route) — and on every successful non-zero adjust,
  // so a stale ghost can't linger.
  const forget = useCallback((key: string) => {
    setZeroed((prev) => {
      if (!prev.has(key)) return prev;      // same Map identity when nothing changes — no needless re-render
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setZeroed((prev) => (prev.size === 0 ? prev : new Map()));
  }, []);

  return { zeroed, remember, forget, clear };
}

// Re-insert remembered zero rows into a fresh server list at the index they held. A ghost whose key is present in `fresh` is dropped:
// the line is genuinely back (restored here, or re-added by another operator), so the real row wins and the ghost would be a duplicate.
export function spliceZeroed<T>(fresh: T[], ghosts: Zeroed<T>[], keyOf: (item: T) => string): T[] {
  if (ghosts.length === 0) return fresh;
  const present = new Set(fresh.map(keyOf));
  const out = fresh.slice();
  for (const g of [...ghosts].sort((a, b) => a.index - b.index)) {
    if (present.has(keyOf(g.payload))) continue;
    out.splice(Math.min(g.index, out.length), 0, g.payload);
  }
  return out;
}
