'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes/[groupid]  (SLOW SIZES -> one style — opened by clicking a Style on /analytics/slow-sizes)
=======================================================================================================================================
Purpose: Every size of one style — in stock, when it last sold (days, then the month), qty sold in the last 12 months — so a stuck size
         can be read against its neighbours. Owner, 2026-10-15: "I would prefer to have the breakdown on a separate screen by clicking
         the style. Not have it in the main list. Too much info." (It opened inline under the list row before that.)

A STRIP OF SIZE TILES, NOT A TABLE (owner, same day: "make it more compact and nicer looking. Too many open spaces with little numbers
         ... rethink the whole layout"). The first cut was a full-width four-column table — a dozen rows of one small number per
         column across the page. Now each size is one small tile, the run reads left to right like the shelf:
           size · in stock ("n in") · days since it last sold (the read, coloured by how long) · the month (secondary — "only reason date
           helps is to see if it is season based") · qty sold in 12 months ("n sold")
         The whole run sits on one line on a wide screen (grid sized to the run, up to 14 sizes), labels kept short to fit.
         The colour is the list's own bands (over a year | 6–12 months | 3–6 months | sold within 3 months), so a tile looks the way
         its box on the list does. A size never sold that we hold is coloured by how long it has been here (on_shelf_days, the list's
         own ranking) — so a size that arrived last month is green, not red (it read as the oldest band until 2026-10-15). 0 stock = faded, dashed — part of the run,
         nothing to clear. NO SIZE IS HIGHLIGHTED (owner, 2026-10-15: "Size 11 is never sold and takes priority for me but I came from size 12. Best we
         dont highlight any") — the screen is the style, not the row you came from; the colours already say which size matters.
         A short line above the tiles carries the totals (in stock, qty sold in 12 months, sizes over a year).

         "Price →" opens the Shopify price drill (← Back returns here); ← Back here returns to the list as it was left (?from=,
         same-site paths only; with none, the list). Rules for every number: routes/analytics-style-sizes.js. READ-ONLY.

         THE SHOE (owner, same day: "a small image of the shoe"): the price drill's own 56px ZoomableThumb, left of the title — click for
         it large. A missing or dead image just leaves the title on its own.

         WORDING: unit counts are "in stock" / "qty", never "pairs" (the owner reads "pairs" as a count of sizes).

Guarded by AppShell. Consumes GET /analytics-style-sizes.
=======================================================================================================================================
*/

import { Suspense, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ZoomableThumb from '@/components/ZoomableThumb';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStyleSizes, StyleSizeRow } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// Month names for 'YYYY-MM-DD' read by split, never the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (s: string) => { const [y, m] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${String(y).slice(2)}`; };

// How long since it sold -> tile colour. Same steps as the list's boxes (91 / 183 / 365 days).
const TONES = {
  y1: { chip: 'bg-rose-100 text-rose-800', label: 'Over a year' },
  m6: { chip: 'bg-orange-100 text-orange-800', label: '6–12 months' },
  m3: { chip: 'bg-yellow-100 text-yellow-800', label: '3–6 months' },
  m0: { chip: 'bg-emerald-100 text-emerald-800', label: 'Within 3 months' },
} as const;
// NEVER SOLD goes by how long it has been HERE (on_shelf_days — its oldest pair's arrival), the same as the list ranks it: a size that
// arrived last month and hasn't sold yet is new, not stuck, so it is green; one here over a year is red. None held = nothing to say.
function tone(x: StyleSizeRow) {
  const days = x.idle_days ?? x.on_shelf_days;
  if (days === null) return null;
  if (days > 365) return TONES.y1;
  if (days > 183) return TONES.m6;
  if (days > 91) return TONES.m3;
  return TONES.m0;
}

// useSearchParams needs a Suspense boundary for Next's build.
export default function SlowSizeStylePage() {
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  );
}

function Body() {
  const params = useParams<{ groupid: string }>();
  const groupid = decodeURIComponent(params.groupid);
  const sp = useSearchParams();
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;

  const q = useApiQuery(`analytics-style-sizes:${groupid}`, () => getStyleSizes(groupid));
  const [imgFailed, setImgFailed] = useState(false);
  const d = q.data;
  const sizes = d?.sizes ?? [];
  const inStock = sizes.reduce((t, x) => t + x.units, 0);
  const sold12m = sizes.reduce((t, x) => t + x.sold_12m, 0);
  const overYear = sizes.filter((x) => x.units > 0 && tone(x) === TONES.y1).length;
  const self = encodeURIComponent(`/analytics/slow-sizes/${encodeURIComponent(groupid)}${sp.toString() ? `?${sp}` : ''}`);

  return (
    <AppShell backHref={from ?? '/analytics/slow-sizes'} backLabel="Slow Sizes">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {d && (
        <div className="max-w-4xl rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {d.imagename && !imgFailed && (
                <ZoomableThumb src={`https://images.brookfieldcomfort.com/${d.imagename}`} alt={d.title || groupid}
                  onError={() => setImgFailed(true)} />
              )}
              <div className="min-w-0">
                <h1 className="text-base font-semibold text-slate-900">{d.title || groupid}</h1>
                <div className="mt-0.5 text-sm text-slate-500">{groupid}{d.brand && ` · ${d.brand}`}</div>
              </div>
            </div>
            <Link href={`/pricing/style/${encodeURIComponent(groupid)}?from=${self}`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50">
              Price &rarr;
            </Link>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
            <span><span className="font-semibold text-slate-900">{n(inStock)}</span> in stock</span>
            <span><span className="font-semibold text-slate-900">{n(sold12m)}</span> sold in 12 months</span>
            {overYear > 0 && (
              <span><span className="font-semibold text-rose-700">{n(overYear)}</span> {overYear === 1 ? 'size' : 'sizes'} not sold for over a year</span>
            )}
          </div>

          {/* The whole run on one line on a wide screen (up to 14 sizes; more wrap) — the --cols var sizes the grid to the run. */}
          <div className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-7 lg:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]"
            style={{ '--cols': Math.min(Math.max(sizes.length, 8), 14) } as CSSProperties}>
            {sizes.map((x) => <SizeTile key={x.code} x={x} />)}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="text-slate-400">Each size: in stock · days since it last sold · sold in 12 months.</span>
            {Object.values(TONES).map((t) => (
              <span key={t.label} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${t.chip}`} />{t.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </AppShell>
  );
}

// One size: the size, in stock, days since it last sold (coloured) over its month, qty sold in 12 months. 0 stock fades back.
function SizeTile({ x }: { x: StyleSizeRow }) {
  const t = tone(x);
  const empty = x.units === 0;
  return (
    <div className={
      'rounded-md border px-1 py-1.5 text-center ' +
      (empty ? 'border-dashed border-slate-200 opacity-60' : 'border-slate-200')
    }>
      <div className="text-base font-semibold leading-tight text-slate-900">{x.size}</div>
      <div className="text-xs text-slate-500" title="In stock">{n(x.units)} in</div>
      <div className={`mt-1.5 rounded px-1 py-1 ${t ? t.chip : 'bg-slate-50 text-slate-400'}`}>
        {/* Every tile leads with a day count: since it last sold, or — never sold — since it arrived, with "no sale" in the
            month's place (a bare "never sold" read as new, owner 2026-10-15). Never sold and none held: nothing to count. */}
        {x.last_sale && x.idle_days !== null ? (
          <>
            <div className="text-sm font-semibold leading-tight tabular-nums">{n(x.idle_days)}d</div>
            <div className="text-[11px] leading-tight opacity-80">{monthLabel(x.last_sale)}</div>
          </>
        ) : x.on_shelf_days !== null ? (
          <>
            <div className="text-sm font-semibold leading-tight tabular-nums">{n(x.on_shelf_days)}d</div>
            <div className="text-[11px] leading-tight opacity-80">no sale</div>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold leading-tight">—</div>
            <div className="text-[11px] leading-tight opacity-80">no sale</div>
          </>
        )}
      </div>
      <div className="mt-1.5 text-xs text-slate-500" title="Sold in the last 12 months">
        {x.sold_12m ? <><span className="font-semibold text-slate-700">{n(x.sold_12m)}</span> sold</> : '0 sold'}
      </div>
    </div>
  );
}
