'use client';
/*
=======================================================================================================================================
Page: /analytics/slow-sizes  (SLOW SIZES — its own Back Office tile, and the "Sizes →" link on Slow, /analytics/stock-sales)
=======================================================================================================================================
Purpose: Every SIZE we hold, by how long since it last sold. Owner, 2026-10-15: "My interest is in individual SKUs that just haven't
         shifted the longest. I get the top 50 of those and work on them ... I will then decide how to deal with them." Slow lists
         STYLES with no sale in 90 days, so a style that sells in its middle sizes never shows there even when one big size has sat
         for a year (the owner's example: Milano). This is that question one level down.

SUMMARY FIRST, THEN THE SIZES (owner, same day: "maybe a summary of your breakdown ... Then I click into it to see the details").
         WORDING (owner, same day): "pairs" reads as a count of SIZES to the owner ("5/8 pairs made a sale"), so stock and sales are
         QTY / "in stock" on screen, never "pairs".
         Bands, each a box with its QTY IN STOCK (the headline — owner, 2026-10-15: "Change the headline figure of the card to Pairs.
         Dont need sizes") and styles. The bands DON'T
         overlap, so they add up to the line above them:
           over a year | 6–12 months | 3–6 months
         ("Up to 3 months" went the same day — owner: "Thats the winners mindset". Sizes that sold in 91 days aren't shown at all;
         the server still returns them, the page just has no box for them.)
         (A fifth, "never sold, here since before 2025", went the same day when pre-log pairs were dated 31 Dec 2024 — owner:
         "everything rolls as standard instead of putting text in". Never-sold sizes now sit in the band their shelf days put them in.)
         (91 / 183 / 365 days — the same steps as Sell-through's age bands, utils/unitAge.js). Clicking a box opens its sizes below,
         longest first; clicking it again closes them. The open band sits in the URL (?band=), so ← Back from the drill reopens it.
         Nothing opens by default — the summary is the first read.

         A LIST, NOT A RULE: no cut-off, no flag, no actions. The owner decides what to do with each; ← Back from the style screen
         returns here with the band and sort kept.

CUT × (owner, same day: "add the cut × like on Slow"). DISPLAY ONLY, exactly as Slow: a row's × takes it off the screen until Reset
         or a reload — nothing is stored, no cut count is shown (owner: "Just cut them away"), the boxes keep their full counts. Cuts are kept while
         you switch boxes.

CLICK THE STYLE (owner, same day: "I would prefer to have the breakdown on a separate screen by clicking the style. Not have it in
         the main list. Too much info."). Style opens /analytics/slow-sizes/[groupid] — the style's full size run, the clicked size
         highlighted — and that screen links on to the price drill. (It opened inline under the row for a few hours; the Style link
         went straight to pricing.)

         Days = since the size last sold, any channel (a return is not a sale; deliveries ignored, as on Slow). DAYS SINCE LAST SOLD
         ONLY on screen (owner, 2026-10-15: "show days since last sold only, drop on shelf" — the two numbers side by side confused).
         LAST SOLD is one column (owner, same day: days first, the month second — "only reason date helps is to see if it is season
         based"), e.g. "754  Sep 24". A never-sold size shows its days since it ARRIVED and "no sale" (e.g. "653  no sale") —
         a bare "never" read as new (owner, same day) — and is still banded and ranked by its days on the shelf (the server's idle_days,
         utils/onShelf.js — oldest pair's arrival, before the log = 31 Dec 2024), so it lands where its wait puts it. Qty sold (12m) = the whole style's net sales in the last 12 months — high there with a big
         Days here is the dead-size-in-a-selling-style case. Rules: routes/analytics-slow-sizes.js.

Guarded by AppShell. Consumes GET /analytics-slow-sizes.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSlowSizes, SlowSize } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// Month names for 'YYYY-MM-DD' read by split, never the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The bands, longest wait first, by days since the last sale (never sold = days on the shelf).
const BANDS = [
  { key: 'y1', label: 'Over a year', sub: 'over 365 days', test: (d: number) => d > 365 },
  { key: 'm6', label: '6–12 months', sub: '184–365 days', test: (d: number) => d > 183 && d <= 365 },
  { key: 'm3', label: '3–6 months', sub: '92–183 days', test: (d: number) => d > 91 && d <= 183 },
] as const;
type BandKey = (typeof BANDS)[number]['key'];

// useSearchParams (← Back origin, band, sort) needs a Suspense boundary for Next's build.
export default function SlowSizesPage() {
  return (
    <Suspense fallback={null}>
      <SlowSizesBody />
    </Suspense>
  );
}

function SlowSizesBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // ← Back: ?from= when Slow sent us here (same-site paths only), else Back Office — the tile is the main door.
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  const back = from ? sp.get('back') || 'Back' : null;

  const rawBand = sp.get('band');
  const open = BANDS.some((b) => b.key === rawBand) ? (rawBand as BandKey) : null;

  const q = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  // CUT — display only (see header). Held here, not in the table, so cuts survive switching boxes.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const sizes = q.data?.sizes ?? [];

  // Click handler, not an effect (docs/maintenance-notes.md). A new band drops the sort — each band opens longest first.
  function toggle(key: BandKey) {
    const nq = new URLSearchParams(sp.toString());
    nq.delete('sort');
    if (open === key) nq.delete('band'); else nq.set('band', key);
    router.replace(`${pathname}${nq.toString() ? `?${nq}` : ''}`, { scroll: false });
  }

  const summary = BANDS.map((b) => {
    const rows = sizes.filter((s) => b.test(s.idle_days));
    return {
      ...b,
      rows,
      pairs: rows.reduce((t, s) => t + s.units, 0),
      styles: new Set(rows.map((s) => s.groupid)).size,
    };
  });
  const openBand = summary.find((b) => b.key === open);

  return (
    <AppShell backHref={from ?? '/dashboard?g=reports'} backLabel={back ?? 'Back Office'}>
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.data && (
        <>
          <div className="mb-3 text-sm text-slate-500">
            {n(summary.reduce((t, b) => t + b.pairs, 0))} in stock in sizes that haven&rsquo;t sold for over 3 months, by how long. Click a
            box for its sizes.
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {summary.map((b) => (
              <button key={b.key} type="button" onClick={() => toggle(b.key)} aria-pressed={open === b.key}
                className={
                  'rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition ' +
                  (open === b.key ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200 hover:border-slate-400')
                }>
                <div className="text-sm font-medium text-slate-700">{b.label}</div>
                <div className="text-xs text-slate-400">{b.sub}</div>
                <div className="mt-2 text-3xl font-semibold leading-none text-slate-900">{n(b.pairs)}</div>
                <div className="mt-1 text-xs text-slate-500">in stock</div>
                <div className="mt-2 text-sm text-slate-500">{n(b.styles)} styles</div>
              </button>
            ))}
          </div>
          {openBand && (
            <SizeTable key={openBand.key} title={openBand.label} sub={openBand.sub} sizes={openBand.rows}
              hidden={hidden} onCut={(code) => setHidden((h) => new Set([...h, code]))} onReset={() => setHidden(new Set())} />
          )}
        </>
      )}
    </AppShell>
  );
}

// Opens in the server's order (longest idle first); headers sort, the sort sits in the URL so ← Back from the drill keeps it.
function SizeTable({ title, sub, sizes, hidden, onCut, onReset }: {
  title: string; sub: string; sizes: SlowSize[];
  hidden: Set<string>; onCut: (code: string) => void; onReset: () => void;
}) {
  const { sorted, sort, onSort } = useTableSort(sizes, {
    groupid: (s) => s.groupid,
    size: (s) => (/^[0-9]+([.][0-9]+)?$/.test(s.size) ? Number(s.size) : s.size),
    brand: (s) => s.brand,
    units: (s) => s.units,
    days: (s) => s.idle_days,
    style_12m: (s) => s.style_sold_12m,
  });
  const th = { sort, onSort };
  const rows = sorted.filter((s) => !hidden.has(s.code));
  const cutHere = sizes.length - rows.length;
  // This page's own URL as it stands (band, sort, origin), so ← Back from the drill lands on the same view.
  const sp = useSearchParams();
  const self = encodeURIComponent(`/analytics/slow-sizes${sp.toString() ? `?${sp}` : ''}`);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="text-sm font-medium text-slate-700">
          {title}{' '}
          <span className="font-normal text-slate-400">· {sub} · {n(sizes.reduce((t, s) => t + s.units, 0))} in stock</span>
        </div>
        {hidden.size > 0 && (
          <button type="button" onClick={onReset} className="text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline">
            Reset
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">{cutHere > 0 ? 'Every row is cut — Reset to bring them back.' : 'No sizes here.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="w-10 px-4 py-2 text-right font-normal">#</th>
                <SortableTh {...th} sortKey="groupid" label="Style" firstDir="asc" />
                <SortableTh {...th} sortKey="size" label="Size" firstDir="asc" />
                <SortableTh {...th} sortKey="brand" label="Brand" firstDir="asc" />
                <SortableTh {...th} sortKey="units" label="In stock" align="right" />
                <SortableTh {...th} sortKey="days" label="Last sold" align="right" title="Days since it last sold, and the month" />
                <SortableTh {...th} sortKey="style_12m" label="Qty sold (12m)" align="right"
                  title="Items of this style sold in the last 12 months, all sizes" />
                <th className="w-8 py-2 pl-0 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.code} className="border-b border-slate-100 text-slate-700 last:border-0">
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link href={`/analytics/slow-sizes/${encodeURIComponent(s.groupid)}?from=${self}`} title={s.title ?? undefined}
                      className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                      {s.groupid}
                    </Link>
                  </td>
                  <td className="px-4 py-2 tabular-nums font-medium text-slate-900">{s.size}</td>
                  <td className="px-4 py-2 text-slate-500">{s.brand || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{n(s.units)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    <LastSold days={s.idle_days} date={s.last_sale} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.style_sold_12m ? n(s.style_sold_12m) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="w-8 py-2 pl-0 pr-4 text-right">
                    <button type="button" aria-label={`Cut ${s.code}`} title="Cut this row (Reset brings it back)"
                      onClick={() => onCut(s.code)}
                      className="px-1 text-base leading-none text-slate-300 hover:text-slate-700">&times;</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// LAST SOLD — one cell: days since the last sale first (the read), the month it sold second and muted (owner, 2026-10-15: "I would
// look at the number of days first, date secondary. Only reason date helps is to see if it is season based") — so month + year only.
// Never sold = "never". The month sits in a fixed-width slot so the day counts line up.
// NEVER SOLD (owner, 2026-10-15: a bare "never" read as NEW): the day count runs from the day its oldest unit arrived, as though that
// were its last sale (the server's idle_days already is), and "no sale" takes the month's slot — so 653 "no sale" reads as stuck
// and 30 "no sale" as new. Every row leads with a number.
function LastSold({ days, date }: { days: number; date: string | null }) {
  let second = 'no sale';
  if (date) { const [y, m] = date.split('-').map(Number); second = `${MONTHS[m - 1]} ${String(y).slice(2)}`; }
  return (
    <>
      <span className="font-semibold text-slate-900">{days.toLocaleString('en-GB')}</span>
      <span className="ml-2 inline-block w-12 text-left text-xs text-slate-400">{second}</span>
    </>
  );
}
