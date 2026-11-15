'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes  (RANGE on screen — the route and the code keep "slow-sizes"; reached from Daily's Range figure)
=======================================================================================================================================
Purpose: THE STOCK LADDER (owner, 2026-11-15 — "adapt Range" rather than build a second screen; design docs/stock-ladder.md, the chart
         is the PDF in the owner's Downloads). Every SKU we hold on exactly ONE of five steps, left to right like the chart:
           STEP 1 Arrived · STEP 2 Sold 90 · STEP 3 Unsold 90 · STEP 4 Unsold 180 · STEP 5 Clearance
         and OVERSTOCKED hanging under step 2 — a LABEL, not a step: its SKUs are inside step 2's count, so the five still add up to
         the total. Rules: bcweb-server/utils/stockLadder.js (THE copy) — this page only draws GET /analytics-stock-ladder.

THE LAYOUT, top to bottom: the total (SKUs held, units under it), then the five step boxes with arrows between them (each: STEP n, its
         name, its rule in a few words, its % of every SKU held as the big number, then SKUs · units), Overstocked under step 2 with
         its SKUs and the pairs over 4 months' worth (the number to sell off). NEW STUFF hangs under step 1 the same way (owner,
         2026-11-15): Daily's New stuff % (of SKUs first booked in within 90 days, the % sold since) — a success rate beside a
         share of the range, kept apart so the steps' own % still add up to 100%.

NOTHING OPENS YET (owner, same day: "No lists or drill down yet"). The boxes and the Overstocked tag will each open their own list
         later — Overstocked is a different list from step 2. The old size run, the four parts and their links (New Additions, Deep
         sellers, the 3–9 months / Clearance lists) were removed from this screen on 2026-11-15; git history has them. The list
         pages (/analytics/slow-sizes/list) still exist, unlinked from here.

THE LOOK follows the chart the owner approved: plain white boxes, STEP n as its own small line so the numbers don't read as quantities
         (owner: "it looks like they are QTYs"), step 2 (the sweet spot) in brand blue, Overstocked a small solid amber tag (colour
         as a mark, not a band — the owner's rule for working screens). No tooltips (owner, 2026-11-06: "complicating my mind").

READ-ONLY.
=======================================================================================================================================
*/

import { Fragment, Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { ChevronRightIcon, ChevronDownIcon, MapIcon } from '@heroicons/react/20/solid';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getProcessOverview, getStockLadder, type LadderStepKey } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// Each step's name and its rule in a few words — the chart's wording.
const STEP_TEXT: Record<LadderStepKey, { name: string; rule: string }> = {
  arrived: { name: 'Arrived', rule: 'came in from 0 stock' },
  sold: { name: 'Sold 90', rule: 'sold in 90 days' },
  unsold90: { name: 'Unsold 90', rule: '91 to 180 days' },
  unsold180: { name: 'Unsold 180', rule: 'to 9 months' },
  clearance: { name: 'Clearance', rule: '9 months + · until sold out' },
};

export default function RangePage() {
  return (
    <Suspense fallback={null}>
      <StockLadderFront />
    </Suspense>
  );
}

function StockLadderFront() {
  const sp = useSearchParams();
  // ← Back: ?from= when another screen sent us here (same-site paths only), else the dashboard.
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const back = from ? sp.get('back') || 'Back' : null;

  const q = useApiQuery('analytics-stock-ladder', () => getStockLadder());
  // NEW STUFF's % (owner, 2026-11-15) — Daily's own figure, same request and key (GET /process-overview, rules utils/processMap.js):
  // of the SKUs first booked in within 90 days, the % sold since. A TAG under Arrived, never in the step's own %, which stays a
  // share of every SKU held so the five add up to 100%.
  const nq = useApiQuery('process-overview', () => getProcessOverview());
  // THE LADDER PICTURE (owner, 2026-11-15: "a small image of the step ladder … clicking it makes it bigger"): the agreed chart
  // (public/stock-ladder.svg, the same drawing as the PDF) behind a small button; a click opens it full size, Esc or a click closes it.
  const [bigChart, setBigChart] = useState(false);
  useEffect(() => {
    if (!bigChart) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBigChart(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bigChart]);
  const newSkus = nq.data ? nq.data.newSkus : null;
  const d = q.data;
  const pctOf = (v: number) => (d && d.held.skus > 0 ? Math.round((v / d.held.skus) * 100) : 0);

  return (
    <AppShell backHref={from ?? '/dashboard'} backLabel={back ?? 'Dashboard'}>
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {!d && !q.error && <p className="text-sm text-slate-400">Loading…</p>}
      {d && (
        <section className="relative rounded-lg border border-slate-200 bg-white px-5 py-6">
          {/* THE TOTAL — what the five steps add up to. */}
          <div className="text-center">
            <span className="text-5xl font-semibold text-slate-900">{n(d.held.skus)}</span>
            <span className="ml-2 text-lg text-slate-500">SKUs</span>
            <div className="mt-1 text-sm tabular-nums text-slate-600">{n(d.held.units)} in stock</div>
          </div>

          {/* THE FIVE STEPS — one row on a wide screen with arrows between (the chart's direction of travel), stacked on a phone. */}
          <div className="mt-8 flex flex-col items-stretch gap-2 lg:flex-row lg:items-start">
            {d.steps.map((s, i) => {
              const t = STEP_TEXT[s.key];
              const sweet = s.key === 'sold';
              const arrived = s.key === 'arrived';
              return (
                <Fragment key={s.key}>
                  {i > 0 && (
                    <div className="flex items-center justify-center text-slate-300 lg:mt-[4.5rem]" aria-hidden>
                      <ChevronRightIcon className="hidden h-6 w-6 lg:block" />
                      <ChevronDownIcon className="h-6 w-6 lg:hidden" />
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col items-center">
                    <div className={'w-full rounded-xl border-2 bg-white px-3 py-4 text-center '
                      + (sweet ? 'border-blue-600' : 'border-slate-300')}>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Step {s.step}</div>
                      <div className="mt-0.5 text-base font-semibold text-slate-900">{t.name}</div>
                      <div className="text-xs text-slate-500">{t.rule}</div>
                      <div className="mt-3 text-4xl font-semibold text-slate-900">{pctOf(s.skus)}%</div>
                      <div className="mt-1 text-sm tabular-nums text-slate-600">
                        <span className="font-semibold text-slate-900">{n(s.skus)}</span> SKU{s.skus === 1 ? '' : 's'}
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span className="font-semibold text-slate-900">{n(s.units)}</span> in stock
                      </div>
                    </div>
                    {/* NEW STUFF — hangs off step 1 like Overstocked off step 2: a different measure on the same subject (owner:
                        "both are different things but on the same subject"), the SUCCESS rate of first-ever arrivals, where the step's
                        own % is its share of the range. */}
                    {arrived && newSkus && (
                      <>
                        <div className="h-3 w-0.5 bg-emerald-600" aria-hidden />
                        <div className="rounded-full border-2 border-emerald-600 bg-emerald-600 px-4 py-1.5 text-center text-white">
                          <div className="text-sm font-semibold">
                            New stuff {newSkus.total > 0 ? Math.round((newSkus.sold / newSkus.total) * 100) : 0}% sold
                          </div>
                          <div className="text-xs tabular-nums">
                            <span className="font-semibold">{n(newSkus.sold)}</span> of {n(newSkus.total)} new SKUs
                          </div>
                        </div>
                      </>
                    )}
                    {/* OVERSTOCKED — hangs off step 2 like the chart's tag: a label on step 2, not a sixth step. */}
                    {sweet && (
                      <>
                        <div className="h-3 w-0.5 bg-amber-400" aria-hidden />
                        <div className="rounded-full border-2 border-amber-400 bg-amber-400 px-4 py-1.5 text-center text-slate-900">
                          <div className="text-sm font-semibold">Overstocked</div>
                          <div className="text-xs tabular-nums">
                            <span className="font-semibold">{n(d.overstocked.skus)}</span> SKU{d.overstocked.skus === 1 ? '' : 's'}
                            <span className="mx-1">·</span>
                            <span className="font-semibold">{n(d.overstocked.over)}</span> pairs over
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
          {/* THE LADDER PICTURE — a small button in the empty corner under steps 4–5 (owner's screenshot, 2026-11-15: a thumbnail
              top right sat on Step 5 and was too small to read); on a phone, under the steps. */}
          <div className="mt-6 flex justify-center lg:absolute lg:bottom-5 lg:right-5 lg:mt-0">
            <button type="button" onClick={() => setBigChart(true)}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
              <MapIcon className="h-4 w-4 text-slate-500" aria-hidden />
              How the steps work
            </button>
          </div>
        </section>
      )}
      {bigChart && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setBigChart(false)}>
          <div role="dialog" aria-modal="true" aria-label="The stock ladder" className="w-full max-w-5xl rounded-xl bg-white p-3 shadow-xl">
            <Image src="/stock-ladder.svg" alt="The stock ladder: five steps and the Overstocked label" width={760} height={440} unoptimized
              className="h-auto w-full" />
          </div>
        </div>
      )}
    </AppShell>
  );
}
