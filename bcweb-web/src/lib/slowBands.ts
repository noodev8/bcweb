/*
=======================================================================================================================================
Lib: slowBands — Slow movers' two boxes after New stuff (owner, 2026-11-06). THE copy: the front screen (/analytics/slow-sizes) counts
     them and each box's screen (/analytics/slow-sizes/list?band=) lists them, so the two always agree.
=======================================================================================================================================
  mid  3–9 months  — 91 days to 9 months without a net sale (ONE box, owner: not two)
  cl   Clearance   — 9 months+ (the server's per-size flag, utils/slowSizes.js)
  The handover from New stuff is exact: New stuff keeps a SKU while its first arrival is ≤ NEW_DAYS ago (server utils/processMap.js);
  a held size joins 3–9 months at NEW_DAYS + 1 days idle (utils/onShelf.js idle clock).
=======================================================================================================================================
*/

import type { SlowSize } from '@/lib/api';

export const NEW_DAYS = 90;

export const SLOW_BANDS = [
  { key: 'mid', label: '3–9 months', sub: `${NEW_DAYS + 1} days – 9 months`, test: (s: SlowSize) => !s.clearance && s.idle_days > NEW_DAYS },
  { key: 'cl', label: 'Clearance', sub: '9 months+', test: (s: SlowSize) => s.clearance },
] as const;
export type SlowBandKey = (typeof SLOW_BANDS)[number]['key'];

// ?band= → a box. Old links' 3–6 / 6–9 month keys (m3 / m6) open 3–9 months.
export const slowBandFromUrl = (v: string | null): SlowBandKey | null =>
  v === 'mid' || v === 'm3' || v === 'm6' ? 'mid' : v === 'cl' ? 'cl' : null;
