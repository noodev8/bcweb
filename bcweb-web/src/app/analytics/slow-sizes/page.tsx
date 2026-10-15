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
         Four bands, each a box with its sizes (the headline — a row is one size of one style), pairs and styles. The bands DON'T
         overlap, so they add up to every size held:
           over a year | 6–12 months | 3–6 months | up to 3 months
         (A fifth, "never sold, here since before 2025", went the same day when pre-log pairs were dated 31 Dec 2024 — owner:
         "everything rolls as standard instead of putting text in". Never-sold sizes now sit in the band their shelf days put them in.)
         (91 / 183 / 365 days — the same steps as Sell-through's age bands, utils/unitAge.js). Clicking a box opens its sizes below,
         longest first; clicking it again closes them. The open band sits in the URL (?band=), so ← Back from the drill reopens it.
         Nothing opens by default — the summary is the first read.

         A LIST, NOT A RULE: no cut-off, no flag, no actions. The owner decides what to do with each; Style opens that style's Shopify
         price drill (size curve and all), ← Back returns here with the band and sort kept.

CUT × (owner, same day: "add the cut × like on Slow"). DISPLAY ONLY, exactly as Slow: a row's × takes it off the screen until Reset
         or a reload — nothing is stored, no cut count is shown (owner: "Just cut them away"), the boxes keep their full counts. Cuts are kept while
         you switch boxes.

CLICK A SIZE ROW (owner, same day: "drill down further when clicking on a style size and seeing all of its sizes and the last time
         each size sold and stock remaining"). The row opens that style's FULL size run underneath (GET /analytics-style-sizes —
         0-stock sizes included), the clicked size highlighted: pairs, last sale, days, sold 90d per size. One open at a time; click
         again to close. The Style link still goes to the price drill.

         Days = since the size last sold, any channel (a return is not a sale; deliveries ignored, as on Slow). Never sold = its On
         shelf days ("never" shows in Last sale). ON SHELF = days since the oldest pair held arrived (utils/onShelf.js; before the log
         = 31 Dec 2024, a floor) — a separate fact (owner, 2026-10-15): Days 300 with On shelf 30 is a re-order of a non-seller, not
         an old pair. A size that sold before 2025 can show Days above On shelf — that is the 31 Dec 2024 floor. Style 90d = the whole style's net sales in 90 days — high there with a big
         Days here is the dead-size-in-a-selling-style case. Rules: routes/analytics-slow-sizes.js.

Guarded by AppShell. Consumes GET /analytics-slow-sizes.
=======================================================================================================================================
*/

import { Fragment, Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSlowSizes, getStyleSizes, SlowSize } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// 'YYYY-MM-DD' -> '2 Aug 25' without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateLabel(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

// The bands, longest wait first, by days since the last sale (never sold = days on the shelf).
const BANDS = [
  { key: 'y1', label: 'Over a year', sub: 'over 365 days', test: (d: number) => d > 365 },
  { key: 'm6', label: '6–12 months', sub: '184–365 days', test: (d: number) => d > 183 && d <= 365 },
  { key: 'm3', label: '3–6 months', sub: '92–183 days', test: (d: number) => d > 91 && d <= 183 },
  { key: 'm0', label: 'Up to 3 months', sub: '0–91 days', test: (d: number) => d <= 91 },
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
      sizes: rows.length,
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
            {n(sizes.length)} sizes held ({n(sizes.reduce((t, s) => t + s.units, 0))} pairs), by how long since each last sold. Click a
            box for its sizes.
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {summary.map((b) => (
              <button key={b.key} type="button" onClick={() => toggle(b.key)} aria-pressed={open === b.key}
                className={
                  'rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition ' +
                  (open === b.key ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200 hover:border-slate-400')
                }>
                <div className="text-sm font-medium text-slate-700">{b.label}</div>
                <div className="text-xs text-slate-400">{b.sub}</div>
                <div className="mt-2 text-3xl font-semibold leading-none text-slate-900">{n(b.sizes)}</div>
                <div className="mt-1 text-xs text-slate-500">sizes</div>
                <div className="mt-2 text-sm text-slate-500">{n(b.pairs)} pairs · {n(b.styles)} styles</div>
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
    last_sale: (s) => s.last_sale,
    days: (s) => s.idle_days,
    shelf: (s) => s.on_shelf_days,
    style_90: (s) => s.style_sold_90,
  });
  const th = { sort, onSort };
  const rows = sorted.filter((s) => !hidden.has(s.code));
  const cutHere = sizes.length - rows.length;
  const [opened, setOpened] = useState<string | null>(null);   // the size row whose style run is open
  // This page's own URL as it stands (band, sort, origin), so ← Back from the drill lands on the same view.
  const sp = useSearchParams();
  const self = encodeURIComponent(`/analytics/slow-sizes${sp.toString() ? `?${sp}` : ''}`);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="text-sm font-medium text-slate-700">
          {title}{' '}
          <span className="font-normal text-slate-400">· {sub} · {n(sizes.length)} sizes</span>
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
                <SortableTh {...th} sortKey="units" label="Pairs" align="right" />
                <SortableTh {...th} sortKey="last_sale" label="Last sale" align="right" />
                <SortableTh {...th} sortKey="days" label="Days" align="right" title="Days since it last sold" />
                <SortableTh {...th} sortKey="shelf" label="On shelf" align="right" title="Days since the oldest pair arrived" />
                <SortableTh {...th} sortKey="style_90" label="Style 90d" align="right"
                  title="Pairs the whole style sold in 90 days, net of returns" />
                <th className="w-8 py-2 pl-0 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <Fragment key={s.code}>
                <tr onClick={() => setOpened(opened === s.code ? null : s.code)} title="Show all sizes of this style"
                  className={`cursor-pointer border-b border-slate-100 text-slate-700 last:border-0 hover:bg-slate-50 ${opened === s.code ? 'bg-slate-50' : ''}`}>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <Link onClick={(e) => e.stopPropagation()} href={`/pricing/style/${encodeURIComponent(s.groupid)}?from=${self}`} title={s.title ?? undefined}
                      className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                      {s.groupid}
                    </Link>
                  </td>
                  <td className="px-4 py-2 tabular-nums font-medium text-slate-900">{s.size}</td>
                  <td className="px-4 py-2 text-slate-500">{s.brand || '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{n(s.units)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                    {s.last_sale
                      ? dateLabel(s.last_sale)
                      : <span className="text-slate-500">never</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{n(s.idle_days)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{n(s.on_shelf_days)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {s.style_sold_90 ? n(s.style_sold_90) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="w-8 py-2 pl-0 pr-4 text-right">
                    <button type="button" aria-label={`Cut ${s.code}`} title="Cut this row (Reset brings it back)"
                      onClick={(e) => { e.stopPropagation(); onCut(s.code); if (opened === s.code) setOpened(null); }}
                      className="px-1 text-base leading-none text-slate-300 hover:text-slate-700">&times;</button>
                  </td>
                </tr>
                {opened === s.code && (
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <td colSpan={10} className="px-4 py-3">
                      <StyleRun groupid={s.groupid} title={s.title} current={s.code} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// THE STYLE'S SIZE RUN — every size (0 stock included), under the clicked row; the clicked size is highlighted. Fetched on open (SWR,
// keyed by style, so reopening is instant). Never a useEffect (docs/maintenance-notes.md).
function StyleRun({ groupid, title, current }: { groupid: string; title: string | null; current: string }) {
  const q = useApiQuery(`analytics-style-sizes:${groupid}`, () => getStyleSizes(groupid));
  if (q.isLoading) return <p className="text-sm text-slate-400">Loading sizes…</p>;
  if (q.error) return <p className="text-sm text-red-700">{q.error.message}</p>;
  const sizes = q.data ?? [];
  const pairs = sizes.reduce((t, x) => t + x.units, 0);
  return (
    <div>
      <div className="mb-2 text-sm text-slate-600">
        <span className="font-medium text-slate-800">{title || groupid}</span>
        <span className="text-slate-400"> · {sizes.length} sizes · {n(pairs)} pairs held</span>
      </div>
      <table className="w-auto text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 pr-8 font-normal">Size</th>
            <th className="py-1 pr-8 text-right font-normal">Pairs</th>
            <th className="py-1 pr-8 text-right font-normal">Last sale</th>
            <th className="py-1 pr-8 text-right font-normal" title="Days since it last sold">Days</th>
            <th className="py-1 pr-8 text-right font-normal" title="Days since the oldest pair arrived">On shelf</th>
            <th className="py-1 text-right font-normal" title="Pairs this size sold in 90 days, net of returns">Sold 90d</th>
          </tr>
        </thead>
        <tbody>
          {sizes.map((x) => (
            <tr key={x.code} className={x.code === current ? 'font-semibold text-slate-900' : x.units ? 'text-slate-700' : 'text-slate-400'}>
              <td className="py-0.5 pr-8 tabular-nums">
                {x.size}{x.code === current && <span className="ml-1 text-xs font-normal text-slate-500">◂</span>}
              </td>
              <td className="py-0.5 pr-8 text-right tabular-nums">{x.units ? n(x.units) : '—'}</td>
              <td className="whitespace-nowrap py-0.5 pr-8 text-right tabular-nums">{x.last_sale ? dateLabel(x.last_sale) : 'never sold'}</td>
              <td className="py-0.5 pr-8 text-right tabular-nums">{x.idle_days ?? '—'}</td>
              <td className="py-0.5 pr-8 text-right tabular-nums">{x.on_shelf_days ?? '—'}</td>
              <td className="py-0.5 text-right tabular-nums">{x.sold_90 ? n(x.sold_90) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
