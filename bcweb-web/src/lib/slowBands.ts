/*
=======================================================================================================================================
Lib: slowBands — how Slow movers splits the sizes we hold (owner, 2026-11-06). THE copy: the front screen (/analytics/slow-sizes),
     each box's list (/analytics/slow-sizes/list?band=) and Daily's tile all read it, so they always agree.
=======================================================================================================================================
  THE TWO SLOW BOXES:
    mid  3–9 months  — 91 days to 9 months without a net sale (ONE box, owner: not two)
    cl   Clearance   — 9 months+ (the server's per-size flag, utils/slowSizes.js; a never-sold size restocked anyway is dated from its
                       first arrival by routes/analytics-slow-sizes.js)
  The handover from New stuff is exact: New stuff keeps a SKU while its first arrival is ≤ NEW_DAYS ago (server utils/processMap.js);
  a held size joins 3–9 months at NEW_DAYS + 1 days idle (utils/onShelf.js idle clock).

  THE FOUR PARTS of every held size (splitHeldSizes) — each size in exactly one:
    new   Not sold yet · first 90 days — New stuff's unsold new SKUs (GET /process-overview rows, isSold) that we hold
    sold  Sold in the last 90 days     — every other held size that isn't slow (incl. the few that sold before and were restocked —
                                         done their job, the restock is the reorder process's business)
    mid / cl                           — the two slow boxes above
=======================================================================================================================================
*/

import type { ProcessSizeRow, SlowSize } from '@/lib/api';
import { isSold } from '@/lib/process';

export const NEW_DAYS = 90;

export const SLOW_BANDS = [
  { key: 'mid', label: '3–9 months', sub: `${NEW_DAYS + 1} days – 9 months`, test: (s: SlowSize) => !s.clearance && s.idle_days > NEW_DAYS },
  { key: 'cl', label: 'Clearance', sub: '9 months+', test: (s: SlowSize) => s.clearance },
] as const;
export type SlowBandKey = (typeof SLOW_BANDS)[number]['key'];

// ?band= → a box. Old links' 3–6 / 6–9 month keys (m3 / m6) open 3–9 months.
export const slowBandFromUrl = (v: string | null): SlowBandKey | null =>
  v === 'mid' || v === 'm3' || v === 'm6' ? 'mid' : v === 'cl' ? 'cl' : null;

export type SlowPartKey = 'new' | 'sold' | SlowBandKey;

// Every held size's part, plus the counts (sizes, and the units in them) per part.
export function splitHeldSizes(sizes: SlowSize[], newRows: ProcessSizeRow[]) {
  const held = new Set(sizes.map((s) => s.code));
  const unsoldNew = new Set(newRows.filter((r) => !isSold(r) && held.has(r.code)).map((r) => r.code));
  const partOf = (s: SlowSize): SlowPartKey => (unsoldNew.has(s.code) ? 'new' : SLOW_BANDS.find((b) => b.test(s))?.key ?? 'sold');
  const counts: Record<SlowPartKey, { sizes: number; units: number }> = {
    new: { sizes: 0, units: 0 }, sold: { sizes: 0, units: 0 }, mid: { sizes: 0, units: 0 }, cl: { sizes: 0, units: 0 },
  };
  for (const s of sizes) { const c = counts[partOf(s)]; c.sizes += 1; c.units += s.units; }
  return { partOf, counts, held: sizes.length };
}
