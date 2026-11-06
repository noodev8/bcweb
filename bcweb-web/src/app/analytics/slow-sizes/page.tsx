'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes  (SLOW MOVERS — the FRONT screen; its Products & stock tile, and the "Sizes →" link on Slow)
=======================================================================================================================================
Purpose: WHAT DO I WORK ON (owner, 2026-11-06). Three counts of SIZES not sold, left to right the life of a size, each opening the
         list it is worked from — the same way New stuff works ("I had a list of 90 day items that were sold and unsold so I worked on
         the unsold"):

           Not sold yet          New SKUs (first booked in on Goods In in the last 90 days — THE New stuff rule, GET /process-overview)
                                 with no net sale since they arrived                                 -> New Additions
           No sale 91 days – 9 months   held sizes 91 days to 9 months without a net sale            -> /analytics/slow-sizes/list?band=mid
           No sale 9 months+            held sizes 9 months+ without a net sale                      -> /analytics/slow-sizes/list?band=cl
         (lib/slowBands has the two Slow boxes; the handover from New stuff at 90 / 91 days is exact.)

SIZES, NOT ITEMS — ONE QUESTION. The same day this screen was briefly a stock REPORT: every item in stock (2,907) as a hero figure,
         split first by size rules ("Selling", "Restocked") and then by each item's own age, with charts. Owner, after: "Why do I care?
         and what can I do about it … Not sure what Im looking at here and it doesnt correspond … Maybe that figure was the catalyst and
         red herring." Stock health by item age ("am I buying faster than I sell?") is a different question — Sell-through answers
         it (utils/unitAge.js) — and it is NOT mixed in here. Every number on this screen is a count of sizes with a list behind it.
         Git history has the report versions.

THE LOOK: one flat row (data, not action cards — owner: "the cards look like action points"), the same format in all three parts,
         the rule as the header (a link to the list — the "simple navigation"), then:
           FOUR PARTS, left to right: Not sold yet · first 90 days | SOLD IN THE LAST 90 DAYS (owner, same day: the 41% "closes the
           100% … give its own box" — every held size that sold at least once in 90 days, one pair counts; NOT "winners", which means
           only the 12-month portfolio status; no list behind it, so no link; it also holds the few sizes that SOLD BEFORE and were
           restocked in the last 90 days — done their job, the restock is the reorder process's business — with no special mention;
           a never-sold size restocked anyway is dated from its first arrival by the server, so it lands in the slow parts) |
           No sale 91 days – 9 months |
           No sale 9 months+. Each shows:
           the count of SIZES — the big number, the work — with its % OF EVERY SIZE WE HOLD (owner, same day, option A: "would there
           be other percentages here that map to 100%?" — one base for all three; a line under the row names the base and "the other
           n%" that sold in the last 90 days or were just restocked, so they visibly make 100%. New stuff's own Sold % (26%) stays on
           Daily / New Additions, where it is the score; New stuff's part here counts only its unsold new SKUs we still hold)
           "n in stock" under it — the units held in exactly those sizes (owner, same day: "Will units help…" then "Its under the same
           headers?" — a separate units section was tried for minutes; same sizes, so same header). Local + Amazon, one number, the
           Slow Sizes stock for all three. Never a grand total of all stock or units by item age (the red herring above).

READ-ONLY. Consumes GET /analytics-slow-sizes and GET /process-overview (Daily's own key, so New stuff's count is Daily's rows).
=======================================================================================================================================
*/

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, getSlowSizes } from '@/lib/api';
import { isSold } from '@/lib/process';
import { NEW_DAYS, SLOW_BANDS } from '@/lib/slowBands';

const n = (v: number) => v.toLocaleString('en-GB');

// A part of the row: its sizes, the units in them, the list it opens (null = no list).
interface Part { key: string; head: string; sizes: number; units: number; href: string | null }

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
  // ← Back: ?from= when Slow sent us here (same-site paths only), else Products & stock — the tile is the main door.
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const back = from ? sp.get('back') || 'Back' : null;
  const self = encodeURIComponent(`${pathname}${sp.toString() ? `?${sp}` : ''}`);

  const sq = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  const nq = useApiQuery('process-overview', () => getProcessOverview());

  // Each part: its SIZES — all of them sizes WE HOLD, so one base (every held size) gives percentages that add to 100% with "the
  // rest" — and the UNITS held in exactly those sizes (local + Amazon, the Slow Sizes stock, one definition for all three). New stuff's
  // part is its unsold new SKUs that are held (a new SKU with nothing left in stock isn't one of the sizes we hold).
  const view = useMemo(() => {
    if (!sq.data || !nq.data) return null;
    const sizes = sq.data.sizes;
    const heldBy = new Map(sizes.map((s) => [s.code, s.units]));
    const unsoldNew = nq.data.rows.filter((r) => !isSold(r) && (heldBy.get(r.code) ?? 0) > 0);
    const unsoldNewCodes = new Set(unsoldNew.map((r) => r.code));
    // SOLD = every other held size: not new-and-unsold, not slow. Nearly all sold in the last 90 days; the rest SOLD BEFORE and were
    // restocked in the last 90 days — a size that sold has done its job, its restock is the reorder process's business (owner,
    // 2026-11-06: "It has done its job here. restock is not this screens problem"), so it counts here with no special mention. (A
    // size that NEVER sold and was restocked anyway is dated from its first arrival by the server, so it lands in the slow parts.)
    // The box's name for the restocked few is held back on purpose (owner: "thats where I could go down a rabbit hole").
    const sold = sizes.filter((s) => !unsoldNewCodes.has(s.code) && !SLOW_BANDS.some((b) => b.test(s)));
    const sum = (list: { units: number }[]) => list.reduce((t, s) => t + s.units, 0);
    const parts: Part[] = [
      { key: 'new', head: `Not sold yet · first ${NEW_DAYS} days`, sizes: unsoldNew.length,
        units: unsoldNew.reduce((t, r) => t + (heldBy.get(r.code) ?? 0), 0),
        href: `/analytics/new-additions?from=${self}&back=${encodeURIComponent('Slow movers')}` },
      { key: 'sold', head: `Sold in the last ${NEW_DAYS} days`, sizes: sold.length, units: sum(sold), href: null },
      ...SLOW_BANDS.map((b): Part => {
        const mine = sizes.filter((s) => b.test(s));
        return { key: b.key, head: `No sale ${b.sub}`, sizes: mine.length, units: sum(mine), href: `/analytics/slow-sizes/list?band=${b.key}&from=${self}` };
      }),
    ];
    return { parts, held: sizes.length, heldUnits: sum(sizes) };
  }, [sq.data, nq.data, self]);
  const pctOf = (v: number) => (view && view.held > 0 ? Math.round((v / view.held) * 100) : 0);

  const error = sq.error?.message ?? nq.error?.message ?? null;

  return (
    <AppShell backHref={from ?? '/dashboard?g=products'} backLabel={back ?? 'Products & stock'}>
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!view && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {view && (
        // THE BASE ON TOP (owner, same day: "promote the 1040 figure"; no header over it — "sizes" by the number says it), every size we hold and the units in
        // them — then ONE ROW, ONE HEADER PER PART: the sizes and their share of that base (the big number), then the units held in
        // exactly those sizes (owner: "Its under the same headers?"). A header with a list behind it is a link; Sold has no list (owner,
        // same day: the 41% "closes the 100% … give its own box"). The parts add back up to the figure on top.
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="px-5 py-5">
            <div>
              <span className="text-5xl font-semibold text-slate-900">{n(view.held)}</span>
              <span className="ml-2 text-lg text-slate-500">sizes</span>
            </div>
            <div className="mt-1 text-sm tabular-nums text-slate-600">{n(view.heldUnits)} in stock</div>
          </div>
          <dl className="grid grid-cols-1 divide-y divide-slate-200 border-t border-slate-200 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
            {view.parts.map((p) => (
              <div key={p.key} className="px-5 py-4">
                <dt className="whitespace-nowrap text-sm font-medium text-slate-800">
                  {p.href ? (
                    <Link href={p.href} className="underline-offset-2 hover:text-brand-700 hover:underline">{p.head} &rarr;</Link>
                  ) : p.head}
                </dt>
                <dd className="mt-2">
                  <span className="text-4xl font-semibold text-slate-900">{n(p.sizes)}</span>
                  <span className="ml-1.5 text-sm text-slate-500">size{p.sizes === 1 ? '' : 's'} · {pctOf(p.sizes)}%</span>
                </dd>
                <dd className="mt-1 text-sm tabular-nums text-slate-600">{n(p.units)} in stock</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </AppShell>
  );
}
