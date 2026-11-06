'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes  (RANGE on screen — owner, 2026-11-06: "lose its 'slow movers' name. Especially in the navigations";
      reached from Daily's Range figure and the "Sizes →" link on Slow. The route and the code keep "slow-sizes".)
=======================================================================================================================================
Purpose: WHAT DO I WORK ON (owner, 2026-11-06). Every SIZE we hold, split four ways, the slow parts each opening the list they are
         worked from — the same way New stuff works ("I had a list of 90 day items that were sold and unsold so I worked on the unsold").

SIZES, NOT ITEMS — ONE QUESTION. The same day this screen was briefly a stock REPORT: every item in stock (2,907) as a hero figure,
         split by size rules and then by each item's own age, with charts. Owner, after: "Why do I care? and what can I do about it …
         Maybe that figure was the catalyst and red herring." Stock health by item age is Sell-through's question (utils/unitAge.js)
         and is NOT mixed in here. Git history has the report versions.

THE LAYOUT, top to bottom (one card):
  1. THE SIZE RUN — the sizes we hold at each UK size, as tiles like a shoe's size run, the TOTAL only (owner, same day: "A size grid
     … to help me get my head around the fact these are sizes … Especially to stop me about thinking of QTY", then "too much data …
     No bar charts. And put it at the top. Just totals"). UK size = skumap.uksize (the route's `uk`), so EU and UK brands share one
     line (Birkenstock EU 38 = UK 5); HALF SIZES ROLL UP to the next whole size (a glance, not exact), 13 and up folded into one
     tile, a child size or none recorded = Other. A count of
     SIZES, never qty. (A 100% column per size, split by part, with a legend and table, was tried for minutes — git history.)
  2. THE TOTAL — "1,039 SKUs" (every SKU we hold stock of), the units in them under it, CENTRED under the tiles as their sum
     (owner: "put the big 1039 as a part of the chart"; no header — "sizes" by the number says it).
  3. THE FOUR PARTS, left to right, adding back up to the total, each with its % OF EVERY SIZE WE HOLD as the big number ("at a
     glance it shows the split"), then its count of sizes and the units in them (readable, not demoted):
       Not sold yet · first 90 days  New stuff's unsold new SKUs that we hold (THE New stuff rule, GET /process-overview) -> New Additions
       Sold in the last 90 days      every other held size that isn't slow — one pair counts; NOT "winners" (that word is the 12-month
                                     status); it also holds the few that SOLD BEFORE and were restocked in 90 days (done their job —
                                     the restock is the reorder process's business), no special mention, name held back on purpose
                                     ("rabbit hole"); no list, so no link
       No sale 91 days – 9 months    -> /analytics/slow-sizes/list?band=mid (lib/slowBands)
       No sale 9 months+             -> /analytics/slow-sizes/list?band=cl  (a never-sold size restocked anyway is dated from its
                                     FIRST arrival by the server, so it lands here)
     New stuff's own Sold % (26% — a different base, the new SKUs) stays on Daily / New Additions. Units = local + Amazon, one number.

ON SCREEN THE UNIT IS "SKUs" (owner, same day: "lets move to SKUs - that might have been a source of my earlier confusion") — each
         style in each size; "sizes" read as shoe sizes (UK 5) beside the size run. The code still says sizes (SlowSize, counts.sizes).

READ-ONLY. Consumes GET /analytics-slow-sizes and GET /process-overview (Daily's own key, so New stuff's count is Daily's rows).
=======================================================================================================================================
*/

import { Suspense, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import { usePathname, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, getSlowSizes } from '@/lib/api';
import { NEW_DAYS, SLOW_BANDS, splitHeldSizes, type SlowPartKey } from '@/lib/slowBands';

const n = (v: number) => v.toLocaleString('en-GB');

type PartKey = SlowPartKey;
const PART_ORDER: PartKey[] = ['new', 'sold', 'mid', 'cl'];
// Each part's header — its rule.
const PART_LABEL: Record<PartKey, string> = {
  new: `Not sold yet · first ${NEW_DAYS} days`,
  sold: `Sold in the last ${NEW_DAYS} days`,
  mid: `No sale ${SLOW_BANDS[0].sub}`,
  cl: `No sale ${SLOW_BANDS[1].sub}`,
};

// THE SIZE RUN's tiles — UK sizes BLENDED: every half size rolls UP to the next whole size (owner, same day: "All half sizes, roll up
// to the next full size. Shortens the number of sizes … Dont have to be exact but it is a good glance" — so UK 5½ counts in 6), the
// thin tail from 13 folded into one tile, then Other (a child size or none recorded).
const TAIL_FROM = 13;
const ukTile = (uk: string | null) => {
  if (uk === null) return 'other';
  const whole = Math.ceil(Number(uk));
  return whole >= TAIL_FROM ? 'tail' : String(whole);
};
const ukLabel = (t: string) => (t === 'other' ? 'Other' : t === 'tail' ? `${TAIL_FROM}+` : t);
const ukOrder = (t: string) => (t === 'other' ? 1e6 : t === 'tail' ? 1e5 : Number(t));

// THE SHADE — each tile's % of its sizes that SOLD IN THE LAST 90 DAYS (sizes, never pairs), darker = more of that size selling
// (owner, same day: "add the shade and the %"). Sequential, ONE hue (the dataviz method's blue ramp, steps 100 -> 600), in 10-point
// steps so close values don't pretend to differ; ink flips to white from the 400 step. The % is printed too, so nothing is colour-only.
const SHADES: { from: number; bg: string; ink: string; sub: string }[] = [
  { from: 55, bg: '#184f95', ink: '#ffffff', sub: '#cde2fb' },
  { from: 45, bg: '#256abf', ink: '#ffffff', sub: '#cde2fb' },
  { from: 35, bg: '#3987e5', ink: '#ffffff', sub: '#e6f0fd' },
  { from: 25, bg: '#6da7ec', ink: '#0b0b0b', sub: '#1c2b44' },
  { from: 15, bg: '#9ec5f4', ink: '#0b0b0b', sub: '#33445e' },
  { from: 0, bg: '#cde2fb', ink: '#0b0b0b', sub: '#52514e' },
];
const shadeFor = (pct: number) => SHADES.find((s) => pct >= s.from) ?? SHADES[SHADES.length - 1];
// One fixed line height for every line of the run (labels and tiles), so the row labels on the left line up with the tiles' lines.
const RUN_LINE = 'flex h-5 items-center leading-none';

export default function SlowMoversFrontPage() {
  return (
    <Suspense fallback={null}>
      <SlowMoversFront />
    </Suspense>
  );
}

function SlowMoversFront() {
  const sp = useSearchParams();
  const pathname = usePathname();
  // ← Back: ?from= when Slow sent us here (same-site paths only), else the dashboard — Daily's Range figure is the main door now
  // (the Products & stock menu tile went 2026-11-06).
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const back = from ? sp.get('back') || 'Back' : null;
  const self = encodeURIComponent(`${pathname}${sp.toString() ? `?${sp}` : ''}`);

  const sq = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  const nq = useApiQuery('process-overview', () => getProcessOverview());

  const view = useMemo(() => {
    if (!sq.data || !nq.data) return null;
    const sizes = sq.data.sizes;
    // The four parts — THE split (lib/slowBands → splitHeldSizes), shared with Daily's tile so the two can't disagree.
    const { counts } = splitHeldSizes(sizes, nq.data.rows);
    const sum = (list: { units: number }[]) => list.reduce((t, s) => t + s.units, 0);
    const hrefs: Record<PartKey, string | null> = {
      new: `/analytics/new-additions?from=${self}&back=${encodeURIComponent('Range')}`,
      sold: null,
      mid: `/analytics/slow-sizes/list?band=mid&from=${self}`,
      cl: `/analytics/slow-sizes/list?band=cl&from=${self}`,
    };
    const parts = PART_ORDER.map((k) => ({ key: k, head: PART_LABEL[k], sizes: counts[k].sizes, units: counts[k].units, href: hrefs[k] }));
    // THE SIZE RUN — per UK size: the sizes held, and how many of them sold in the last 90 days (a last net sale on or after this day).
    const [y, m, d] = sq.data.today.split('-').map(Number);
    const soldSince = new Date(Date.UTC(y, m - 1, d - NEW_DAYS)).toISOString().slice(0, 10);
    const runBy = new Map<string, { count: number; sold: number; units: number }>();
    for (const s of sizes) {
      const t = ukTile(s.uk);
      const r = runBy.get(t) ?? { count: 0, sold: 0, units: 0 };
      r.count += 1;
      r.units += s.units;
      if (s.last_sale && s.last_sale >= soldSince) r.sold += 1;
      runBy.set(t, r);
    }
    const run = [...runBy.entries()].sort((a, b) => ukOrder(a[0]) - ukOrder(b[0]))
      .map(([t, r]) => ({ t, label: ukLabel(t), count: r.count, units: r.units, pct: Math.round((r.sold / r.count) * 100) }));
    return { parts, run, held: sizes.length, heldUnits: sum(sizes) };
  }, [sq.data, nq.data, self]);
  const pctOf = (v: number) => (view && view.held > 0 ? Math.round((v / view.held) * 100) : 0);

  const error = sq.error?.message ?? nq.error?.message ?? null;

  return (
    <AppShell backHref={from ?? '/dashboard'} backLabel={back ?? 'Dashboard'}>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!view && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {view && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="px-5 py-5">
            {/* 1. THE SIZE RUN — sizes we hold per UK size, totals only. */}
            {/* Centred (owner, same day: "center the grid on the screen"), with a caption saying what the numbers are — sizes HELD,
                not sales (owner: "are those numbers the sales?"). */}
            {/* STOCK PRINTED ON THE TILES — a trial (owner, same day: "try the printed version first and we can take it out"): the
                in-stock qty behind each UK size, its depth. A row-label column on the left names the four lines (the lines share fixed
                heights so they line up across the tiles). */}
            <div className="flex flex-wrap items-stretch justify-center gap-1.5">
              <div className="mr-1 flex flex-col items-end py-1 text-[11px] text-slate-500">
                <span className={RUN_LINE + ' font-medium'}>UK</span>
                <span className={RUN_LINE} title="Each style in each size — one SKU">SKUs</span>
                <span className={RUN_LINE}>in stock</span>
                <span className={RUN_LINE}>sold 90d</span>
              </div>
              {view.run.map((r) => {
                const sh = shadeFor(r.pct);
                return (
                  <div key={r.t} title={`UK ${r.label}: ${n(r.count)} SKUs held · ${n(r.units)} in stock · ${r.pct}% sold in the last ${NEW_DAYS} days`}
                    className="flex min-w-[2.75rem] flex-col items-center rounded-md px-1.5 py-1" style={{ background: sh.bg }}>
                    <span className={RUN_LINE + ' text-sm font-semibold'} style={{ color: sh.ink }}>{r.label}</span>
                    <span className={RUN_LINE + ' text-xs tabular-nums'} style={{ color: sh.sub }}>{n(r.count)}</span>
                    <span className={RUN_LINE + ' text-xs tabular-nums'} style={{ color: sh.sub }}>{n(r.units)}</span>
                    <span className={RUN_LINE + ' text-[11px] font-medium tabular-nums'} style={{ color: sh.ink }}>{r.pct}%</span>
                  </div>
                );
              })}
            </div>
            {/* 2. THE TOTAL — part of the chart (owner, same day: "put the big 1039 as a part of the chart"): centred directly under the
                tiles, the sum they add up to, then the caption for the whole block. */}
            <div className="mt-4 text-center">
              <span className="text-5xl font-semibold text-slate-900">{n(view.held)}</span>
              <span className="ml-2 text-lg text-slate-500">SKUs</span>
              <div className="mt-1 text-sm tabular-nums text-slate-600">{n(view.heldUnits)} in stock</div>
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              half sizes counted in the next whole size · darker = more of that size sold in the last {NEW_DAYS} days
            </p>
          </div>

          {/* 3. THE FOUR PARTS — adding back up to the total. Each a complete card, centred like Daily's boxes, and THE WHOLE CARD is the
              link (owner, 2026-11-06: "make the card clickable instead of tapping on the text. And tidy up the cards to make them look
              more complete"). Sold has no list behind it: the same card, not a link. */}
          <div className="grid grid-cols-1 gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.parts.map((p) => (
              <PartCard key={p.key} href={p.href}>
                <div className="text-sm font-medium text-slate-800">{p.head}</div>
                <div className="mt-2 text-4xl font-semibold text-slate-900">{pctOf(p.sizes)}%</div>
                <div className="mt-1.5 text-slate-600">
                  <span className="text-xl font-semibold text-slate-800">{n(p.sizes)}</span> SKU{p.sizes === 1 ? '' : 's'}
                  <span className="mx-1.5 text-slate-300">·</span>
                  <span className="text-xl font-semibold text-slate-800">{n(p.units)}</span> in stock
                </div>
              </PartCard>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}

// A part's card: bordered, centred. With a list behind it the whole card is the link (a small arrow in the corner says so, and it lifts
// on hover); without one it is the same card, inert.
function PartCard({ href, children }: { href: string | null; children: ReactNode }) {
  const card = 'relative flex flex-col items-center rounded-xl border border-slate-200 bg-white px-4 py-5 text-center';
  if (!href) return <div className={card}>{children}</div>;
  return (
    <Link href={href}
      className={card + ' outline-none transition hover:border-brand-500 hover:shadow-md focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-100'}>
      <ChevronRightIcon aria-hidden className="absolute right-3 top-3 h-4 w-4 text-slate-400" />
      {children}
    </Link>
  );
}
