'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-sales  (Reports — Stock vs Sales)
=======================================================================================================================================
Purpose: Is the stock we buy shifting? The owner's read on whether to slow ordering down or speed it up (2026-10-09: "Just sales
         against stock position"). Replaced the Stock Position gauge (a count of "alive" products, recorded by an Update button).

HIGH LEVEL ON PURPOSE (owner, 2026-10-09)
         The first cut had weekly panels, a Shopify/Amazon/Shop split, a hover readout, a Week|Month switch on the chart and a full
         table, and the owner's verdict was "too many things going on — I really want it simple". So, top to bottom:
           1. four big numbers — units in stock, sold in 30 days, % of stock sold, excess units
           2. the numbers as a list, Month | Week, with % sold
           3. how deep the stock is — each style against its own pace of sales
           4. the same, by brand (on trial)
         Per-channel detail already lives on the Sales report; don't grow this page back into it.

NO CHART (removed 2026-10-09, owner)
         There was a monthly stock-line-over-sold-bars chart. The owner's verdict: "it just looks obvious" — it showed the seasons he
         already knows, and the decisions came from the list's % sold and the depth card. Don't add it back without a question it
         answers that the list doesn't.

% SOLD — THE OWNER'S MEASURE ("buy it, sell it, quick")
         Sold in the period ÷ stock at the end of it. It swings with the season (≈8% in January, ≈42% in June 2026), so it is read down
         the list against the same month a year earlier, not against a fixed target. No verdict tile: the owner asked for the list.

STOCK DEPTH — WHY THE CARD EXISTS
         Asked "have I over-ordered?", the whole-book numbers said no: stock turned 3.1x in the year, up from 2.6x. Splitting it per
         style said otherwise — a third of all units sat in styles holding more than a year of their own sales. The fast half carried
         the average. Owner: "over-deep stock … I could have done just as much with less invoices", and "we should be able to see it in
         the data". The card shows units by depth band and lists the styles behind each; a row opens the usual product actions (reprice
         etc.). Right NOW only — there is no per-style stock history to trend. The list works by Group ID (title on hover) with a brand
         column, and a By brand card follows it (on trial — the owner may drop it).

EXCESS UNITS (owner, 2026-10-09) — the target to drive down: stock beyond what each style needs (Birkenstock 6 months of its own
         sales, re-orderable brands 2). Shown as the fourth big number. Counts only stock we HOLD (local + Amazon), never Birk Tracker
         orders — those count once they land.

Guarded by AppShell. Consumes GET /analytics-stock-sales and GET /analytics-stock-depth.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { useProductActions } from '@/components/ProductActions';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStockSales, getStockDepth, StockSalesPeriod, StockDepthBand, StockDepthData } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// 'YYYY-MM-DD' -> parts without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
const dayLabel = (s: string) => `${ymd(s).d} ${MONTHS[ymd(s).m - 1]}`;
const monthLabel = (s: string) => `${MONTHS[ymd(s).m - 1]} ${ymd(s).y}`;
const weekLabel = (s: string) => `${dayLabel(s)} ${String(ymd(s).y).slice(2)}`; // the Monday the week starts

export default function StockSalesPage() {
  const q = useApiQuery('analytics-stock-sales', () => getStockSales());
  const depthQ = useApiQuery('analytics-stock-depth', () => getStockDepth());
  const d = q.data;
  const stale = d?.latest && d.latest.date < d.expected_date;

  return (
    <AppShell backHref="/analytics" backLabel="Reports">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}

      {stale && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The latest stock reading is {dayLabel(d!.latest!.date)} — the nightly job hasn&rsquo;t recorded {dayLabel(d!.expected_date)}.
          Check Bclog for a &ldquo;Stock Daily&rdquo; entry.
        </div>
      )}

      {/* The four numbers to watch. % sold is the owner's own measure (sold in 30 days ÷ stock now) — push it up. Excess is stock bought
          beyond what each style needs (Birkenstock 6 months of its own sales, everything else 2) — drive it down. Both move the right
          way by selling deep stock OR by not re-buying it. */}
      {d && d.latest && (
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Hero value={n(d.latest.units)} label="units in stock" />
          <Hero value={n(d.sold_30d)} label="sold in the last 30 days" />
          <Hero value={d.latest.units ? `${Math.round((d.sold_30d / d.latest.units) * 100)}%` : '—'} label="of stock sold in 30 days" />
          <Hero value={depthQ.data ? n(depthQ.data.excess_units) : '…'} label="excess units, beyond need" />
        </div>
      )}

      {d && d.months.length > 0 && <PeriodList months={d.months} weeks={d.weeks} />}

      {depthQ.error && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{depthQ.error.message}</div>}
      {depthQ.data && depthQ.data.rows.length > 0 && (
        <>
          <Depth data={depthQ.data} />
          <Brands rows={depthQ.data.rows} />
        </>
      )}
    </AppShell>
  );
}

function Hero({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-4xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// LIST — the numbers, newest first, Month | Week, so the seasons can be read down the page (owner: "I can see how it fluctuates
// through the seasons"). Stock history starts Oct 2025, so the list grows a row a period.
// -------------------------------------------------------------------------------------------------------------------------------------
function PeriodList({ months, weeks }: { months: StockSalesPeriod[]; weeks: StockSalesPeriod[] }) {
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const rows = (grain === 'month' ? months : weeks).slice().reverse();
  const label = grain === 'month' ? monthLabel : weekLabel;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {(['month', 'week'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrain(g)}
              aria-pressed={grain === g}
              className={
                'rounded-md px-3 py-1 text-sm font-medium capitalize transition ' +
                (grain === g ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[30rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2.5 text-left font-semibold">{grain === 'month' ? 'Month' : 'Week'}</th>
              <th className="px-5 py-2.5 text-right font-semibold">In stock</th>
              <th className="px-5 py-2.5 text-right font-semibold">Sold</th>
              <th className="px-5 py-2.5 text-right font-semibold">% sold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const pct = p.stock ? Math.round((p.sold / p.stock) * 100) : null;
              return (
                <tr key={p.start} className={`border-b border-slate-100 last:border-0 ${p.partial ? 'text-slate-400' : 'text-slate-700'}`}>
                  <td className="whitespace-nowrap px-5 py-2">
                    {label(p.start)}
                    {p.partial && <span className="ml-2 text-xs">so far</span>}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{p.stock === null ? '—' : n(p.stock)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{n(p.sold)}</td>
                  <td className={`px-5 py-2 text-right tabular-nums ${p.partial ? '' : 'font-semibold text-slate-900'}`}>
                    {pct === null ? '—' : `${pct}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// DEPTH — how many months of its OWN sales each style's stock represents. One bar of all units split by depth, then the styles behind
// whichever band is picked (Over a year by default — the over-deep pile). Depth bands are ordinal, so they share one blue ramp, lighter
// = shallower; "not selling" and "new" are a different kind of thing and sit in neutral greys. Every segment is labelled, so colour
// never carries the meaning alone.
// -------------------------------------------------------------------------------------------------------------------------------------
const BANDS: Record<StockDepthBand, { label: string; color: string }> = {
  under6: { label: 'Under 6 months', color: '#86b6ef' },
  '6to12': { label: '6–12 months', color: '#3987e5' },
  over12: { label: 'Over a year', color: '#184f95' },
  none: { label: 'Not selling', color: '#64748b' },
  new: { label: 'New, under 8 weeks', color: '#cbd5e1' },
};

// Months of stock as a reader would say it: "8 mo" up to two years, then years.
function depthLabel(m: number | null) {
  if (m === null) return '—';
  if (m < 24) return `${m < 10 ? m.toFixed(1) : Math.round(m)} mo`;
  return `${(m / 12).toFixed(1)} yrs`;
}

function Depth({ data }: { data: StockDepthData }) {
  const [sel, setSel] = useState<StockDepthBand>('over12');
  const actions = useProductActions();
  const total = data.bands.reduce((s, b) => s + b.units, 0);
  const rows = data.rows
    .filter((r) => r.band === sel)
    .sort((a, b) => (b.months ?? 0) - (a.months ?? 0) || b.units - a.units);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="px-5 pt-4">
        <h2 className="text-sm font-semibold text-slate-800">How deep is the stock?</h2>
        <p className="mt-0.5 text-xs text-slate-500">Each style&rsquo;s stock against its own pace of selling over the last 12 months.</p>

        {/* One bar: all units, split by depth. 2px surface gap between segments. */}
        <div className="mt-3 flex h-7 w-full gap-0.5 overflow-hidden rounded-md">
          {data.bands.filter((b) => b.units > 0).map((b) => (
            <button
              key={b.band}
              type="button"
              onClick={() => setSel(b.band)}
              title={`${BANDS[b.band].label}: ${n(b.units)} units`}
              className={`h-full transition ${sel === b.band ? '' : 'opacity-60 hover:opacity-90'}`}
              style={{ width: `${(b.units / total) * 100}%`, backgroundColor: BANDS[b.band].color }}
            />
          ))}
        </div>

        {/* The bands as labelled choices — the readable half of the bar. */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {data.bands.map((b) => (
            <button
              key={b.band}
              type="button"
              onClick={() => setSel(b.band)}
              aria-pressed={sel === b.band}
              className={`rounded-md border px-3 py-2 text-left transition ${
                sel === b.band ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: BANDS[b.band].color }} />
                {BANDS[b.band].label}
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                {n(b.units)} <span className="text-sm font-normal text-slate-500">units · {total ? Math.round((b.units / total) * 100) : 0}%</span>
              </div>
              <div className="text-xs text-slate-400">{n(b.styles)} {b.styles === 1 ? 'style' : 'styles'}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 max-h-[28rem] overflow-auto border-t border-slate-100">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-400">Nothing in this band.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 text-left font-semibold">Group ID</th>
                <th className="px-3 py-2.5 text-left font-semibold">Brand</th>
                <th className="px-3 py-2.5 text-right font-semibold">In stock</th>
                <th className="px-3 py-2.5 text-right font-semibold">Sold, 12 months</th>
                <th className="px-3 py-2.5 text-right font-semibold">Stock lasts</th>
                <th className="px-5 py-2.5 text-right font-semibold">Excess</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.groupid}
                  onClick={(e) => actions.open(e, r.groupid, { title: r.title })}
                  className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50"
                >
                  {/* Group ID is what the owner works by; the title rides on hover (owner, 2026-10-09). */}
                  <td className="whitespace-nowrap px-5 py-2 text-slate-700" title={r.title || undefined}>{r.groupid}</td>
                  <td className="px-3 py-2 text-slate-500">{r.brand || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{n(r.units)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{n(r.sold)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{depthLabel(r.months)}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-700">{r.excess ? n(r.excess) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-400">
        Styles under a year old are judged on their sales since they were added. Excess = units beyond what the style needs:
        6 months of its own sales for Birkenstock (bought a season ahead), 2 months for brands that can be re-ordered any week.
      </p>
      {actions.node}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// BRANDS — the same stock, per brand. Built 2026-10-09 because the first split by brand answered "how did I get so deep?": 855 of the
// 954 over-a-year units were Birkenstock (season buys, 1.6 turns a year) while Lunar, ordered weekly, turned 7x. On trial — the owner
// may drop it if the page gets busy, so it is its own card, removable in one line above.
// Turns a year = sold ÷ stock. Sold uses each style's own window (12 months, or its life if younger), as on the depth card.
// -------------------------------------------------------------------------------------------------------------------------------------
function Brands({ rows }: { rows: StockDepthData['rows'] }) {
  const by = new Map<string, { units: number; sold: number; over12: number; excess: number }>();
  for (const r of rows) {
    const k = r.brand || '—';
    const b = by.get(k) ?? { units: 0, sold: 0, over12: 0, excess: 0 };
    b.units += r.units;
    b.sold += r.sold;
    if (r.band === 'over12') b.over12 += r.units;
    b.excess += r.excess;
    by.set(k, b);
  }
  const list = Array.from(by, ([brand, b]) => ({ brand, ...b })).sort((a, b) => b.units - a.units);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
      <h2 className="px-5 pt-4 text-sm font-semibold text-slate-800">By brand</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 text-left font-semibold">Brand</th>
            <th className="px-3 py-2.5 text-right font-semibold">In stock</th>
            <th className="px-3 py-2.5 text-right font-semibold">Sold, 12 months</th>
            <th className="px-3 py-2.5 text-right font-semibold">Turns a year</th>
            <th className="px-3 py-2.5 text-right font-semibold">Over a year</th>
            <th className="px-5 py-2.5 text-right font-semibold">Excess</th>
          </tr>
        </thead>
        <tbody>
          {list.map((b) => (
            <tr key={b.brand} className="border-b border-slate-100 text-slate-700 last:border-0">
              <td className="px-5 py-2">{b.brand}</td>
              <td className="px-3 py-2 text-right tabular-nums">{n(b.units)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{n(b.sold)}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                {b.units ? `${(b.sold / b.units).toFixed(1)}×` : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{b.over12 ? n(b.over12) : '—'}</td>
              <td className="px-5 py-2 text-right tabular-nums">{b.excess ? n(b.excess) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
