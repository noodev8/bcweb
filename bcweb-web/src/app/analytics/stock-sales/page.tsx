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
           1. three big numbers — units in stock, sold in 30 days, % of stock sold
           2. the numbers as a list, Month | Week, with % sold
         Per-channel detail already lives on the Sales report; don't grow this page back into it.

NO EXCESS (removed 2026-10-10, owner: "Let's not have anything regarding EXCESS")
         A depth card (stock as months of each style's own sales), an "excess units" number (stock beyond 6 months' need for
         Birkenstock, 2 for the rest), a by-brand card, a Repricing excess list, a Google Ads excess chip and a Shopify clearance tag
         built on them all went the same day. Every version of the rule forecast from past pace, and seasonal buying beats that: a
         Zermatt bought in August for the winter run, selling well, read as 29 excess and a clearance candidate. 12-month pace, 30/90-day
         pace, last year's same months and 12 months' need were all tried and rejected; so was "aged stock" (owner: "I can easily order
         something I feel will sell well"). The code is in git history (commits f0ed513, e4f91fd, dd28eb4). Don't put a stock-needs rule
         back without the owner.

NO CHART (removed 2026-10-09, owner)
         There was a monthly stock-line-over-sold-bars chart. The owner's verdict: "it just looks obvious" — it showed the seasons he
         already knows, and the decisions came from the list's % sold. Don't add it back without a question it
         answers that the list doesn't.

% SOLD — THE OWNER'S MEASURE ("buy it, sell it, quick")
         Sold in the period ÷ stock at the end of it. It swings with the season (≈8% in January, ≈42% in June 2026), so it is read down
         the list against the same month a year earlier, not against a fixed target. No verdict tile: the owner asked for the list.

Guarded by AppShell. Consumes GET /analytics-stock-sales.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStockSales, StockSalesPeriod } from '@/lib/api';

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

      {/* The three numbers to watch. % sold is the owner's own measure (sold in 30 days ÷ stock now) — push it up. */}
      {d && d.latest && (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Hero value={n(d.latest.units)} label="units in stock" />
          <Hero value={n(d.sold_30d)} label="sold in the last 30 days" />
          <Hero value={d.latest.units ? `${Math.round((d.sold_30d / d.latest.units) * 100)}%` : '—'} label="of stock sold in 30 days" />
        </div>
      )}

      {d && d.months.length > 0 && <PeriodList months={d.months} weeks={d.weeks} />}
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
// through the seasons"). Stock history starts Oct 2025, so the list grows a row a period — capped at the newest LIST_ROWS so the card
// never scrolls inside itself (owner: no scroll bar on this grid).
// -------------------------------------------------------------------------------------------------------------------------------------
const LIST_ROWS = 24;

function PeriodList({ months, weeks }: { months: StockSalesPeriod[]; weeks: StockSalesPeriod[] }) {
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const rows = (grain === 'month' ? months : weeks).slice(-LIST_ROWS).reverse();
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
      <table className="w-full text-sm">
        <thead>
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
  );
}
