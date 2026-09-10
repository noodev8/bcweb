/*
=======================================================================================================================================
Module: src/lib/locationsUi.ts
=======================================================================================================================================
The shapes the Locations screen works in, plus a placeholder set of racks to build the UI against.

WHY THE FIXTURE IS HERE AND NOT IN THE COMPONENT. The screen is being built before its routes exist (owner, 2026-09-10 — "don't worry
about backend logic yet"), and a shelf screen with no shelves on it cannot be judged: the whole design question is whether a rack's
contents read at a glance, and that only shows up against real-looking volume. So the sample lives in one clearly-labelled file that
the component imports the same way it will later import from api.ts. When the routes land, `SAMPLE_RACKS` is deleted, the two types
below move to api.ts beside every other endpoint's types, and the component changes by one import.

THE TYPES ARE NOT INVENTED, they are what the DB already holds, so the fixture cannot teach us habits the real data won't support:
  - a rack is a row of the `location` table — name, its own printed barcode ('LC-58'), and the pickorder the racks are walked in.
    EVERY rack exists whether or not it holds anything (utils/locations.js) — an empty shelf is exactly where a box gets put, so the
    picker must list them.
  - a line on a rack is `localstock` collapsed the way InvLocations already collapses it: the same pair can be one row of qty 2 or two
    rows of qty 1 depending how it was scanned, and the operator wants one line per code per state. `ids` carries the underlying rows
    so a later write adjusts those exact ones.
  - `state` mirrors InvLocationRow: FREE is the normal case and is deliberately untagged; PICKED and AMZ are the exceptions worth a
    badge. Amazon stock is present-but-flagged, never greyed out — a unit in the bay can still be taken for a Shopify customer.
  - `size` is RIGHT(code,2) (CLAUDE.md) and is shown as its own column rather than left buried in the code.
=======================================================================================================================================
*/

export type RackState = 'FREE' | 'PICKED' | 'AMZ';

/** One shelf that EXISTS — a `location` row. `units` is what it currently holds, which is a localstock question answered alongside. */
export interface Rack {
  location: string;
  barcode: string | null;
  pickorder: number | null;
  units: number;
}

/** One line of stock on a rack: a code + state, with every localstock id behind it. */
export interface RackLine {
  key: string;
  code: string;
  title: string;
  size: string;
  qty: number;
  state: RackState;
  ids: string[];
}

/** The area a rack belongs to — the location string's prefix, mirroring utils/locations.js exactly. Keep the two in step. */
export function areaOf(location: string): string {
  const l = location.toLowerCase();
  if (l.startsWith('c1-')) return 'C1';
  if (l.startsWith('c3-front-')) return 'C3-Front';
  if (l.startsWith('c3-back-')) return 'C3-Back';
  if (l.startsWith('c3-amazon')) return 'C3-Amazon';
  if (l.startsWith('c3-shop')) return 'C3-Shop';
  return 'OTHER';
}

/** Area order: the busy shelving first, the Amazon bay and the stray bucket last (AREA_ORDER, utils/locations.js). */
export const AREA_ORDER = ['C3-Front', 'C3-Back', 'C1', 'C3-Shop', 'C3-Amazon', 'OTHER'] as const;

/** Written the way a person says it — only the catch-all reads badly as-is. */
export const AREA_LABEL: Record<string, string> = { OTHER: 'Other' };

/** Only the exceptions get a badge; FREE is the common case and stays blank (see InvLocations for the same call). */
export const STATE_BADGE: Partial<Record<RackState, { label: string; cls: string }>> = {
  PICKED: { label: 'Pick', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  AMZ: { label: 'Amazon', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
};

// =====================================================================================================================================
// PLACEHOLDER DATA — delete with the fixture note above once /locations-racks and /locations-contents exist.
// =====================================================================================================================================

const SAMPLE_TITLES: [string, string][] = [
  ['1005292-ARIZONA-BS', 'Arizona Birko-Flor Black'],
  ['0051793-GIZEH-BS', 'Gizeh Birko-Flor White'],
  ['1019099-MADRID-BS', 'Madrid Big Buckle Cognac'],
  ['0552761-BOSTON-BS', 'Boston Suede Taupe'],
  ['1024534-MAYARI-BS', 'Mayari Birko-Flor Graceful'],
  ['1017723-ZURICH-BS', 'Zurich Habana Oiled Leather'],
];

/** Deterministic pseudo-random so the sample is the same on every render and between server and client. */
function seeded(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function sampleLines(seed: number, count: number): RackLine[] {
  const out: RackLine[] = [];
  for (let i = 0; i < count; i++) {
    const [code, title] = SAMPLE_TITLES[Math.floor(seeded(seed + i) * SAMPLE_TITLES.length)];
    const size = String(36 + Math.floor(seeded(seed + i + 100) * 8));
    const r = seeded(seed + i + 200);
    const state: RackState = r > 0.9 ? 'PICKED' : 'FREE';
    const qty = 1 + Math.floor(seeded(seed + i + 300) * 3);
    out.push({
      key: `${seed}-${i}`,
      code: `${code}-${size}`,
      title,
      size,
      qty,
      state,
      ids: Array.from({ length: qty }, (_, k) => `LS-${seed}-${i}-${k}`),
    });
  }
  return out;
}

function rack(location: string, barcode: string, pickorder: number, seed: number, lineCount: number) {
  const lines = sampleLines(seed, lineCount);
  return { location, barcode, pickorder, lines };
}

/** Every rack, with its contents — the two calls' worth of data the real screen will hold. */
export const SAMPLE_RACKS: (Rack & { lines: RackLine[] })[] = [
  rack('C3-Front-01', 'LC-11', 10, 1, 5),
  rack('C3-Front-02', 'LC-12', 20, 2, 3),
  rack('C3-Front-03', 'LC-13', 30, 3, 0),
  rack('C3-Front-04', 'LC-14', 40, 4, 7),
  rack('C3-Front-05', 'LC-15', 50, 5, 2),
  rack('C3-Back-Stage', 'LC-20', 60, 6, 9),
  rack('C3-Back-01', 'LC-21', 70, 7, 4),
  rack('C3-Back-02', 'LC-22', 80, 8, 0),
  rack('C3-Back-03', 'LC-23', 90, 9, 6),
  rack('C1-01', 'LC-31', 100, 10, 3),
  rack('C1-02', 'LC-32', 110, 11, 0),
  rack('C1-03', 'LC-33', 120, 12, 0),
  rack('C1-04', 'LC-34', 130, 13, 5),
  rack('C3-Shop', 'LC-40', 140, 14, 4),
  rack('C3-Amazon', 'LC-50', 150, 15, 8),
  rack('C3-Office', null, null, 16, 1),
].map((r) => {
  // The bay's stock is Amazon-flagged by definition — it is what the flag means. Everywhere else keeps the sampled state.
  const lines = areaOf(r.location) === 'C3-Amazon' ? r.lines.map((l) => ({ ...l, state: 'AMZ' as RackState })) : r.lines;
  return { ...r, lines, units: lines.reduce((n, l) => n + l.qty, 0) };
});
