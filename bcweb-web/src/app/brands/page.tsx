'use client';
/*
=======================================================================================================================================
Page: /brands  (Brands module — overview)
=======================================================================================================================================
Purpose: The shape of the business by BRAND. Revenue, net profit, margin and units per brand over a long window — 12 months by
         default, 6 months the alternative — each read against THE SAME WINDOW ONE YEAR EARLIER, so a brand shows as a level AND a
         direction. Year-on-year rather than against the preceding block because the business is seasonal: comparing a summer to
         the winter before it measures the season, not the brand (see routes/brand-overview.js).

         It answers one question the pricing and ordering screens can't: not "which style should I move?" but "which brands are
         actually earning, and which are just turning stock over?". Margin is the column that pays for the screen — the biggest
         revenue line is not automatically the biggest profit line, and this is where that divergence is visible in one read.

         Three rules, all enforced SERVER-SIDE so the totals can never disagree with the table (see routes/brand-overview.js):
           - SKECHERS IS EXCLUDED outright — footnoted below the table rather than hidden, so the totals are honestly labelled.
           - The sub-threshold tail folds into ONE "Others" row, expandable to show exactly which brands are inside it.
           - Returns are included and NETTED (a refund is a real negative-profit line), so units read sold / returned / net.

         Long windows only, by design: brand mix moves at the pace of buying decisions, not daily trade, and Birkenstock is a
         summer sandal business — a 30-day brand table would mostly be season. The daily pulse lives on Analytics -> Sales.

         Channel-filterable (All / Shopify / Amazon / Shop). Amazon pays an FBA fee on every unit, so a brand's margin is genuinely
         a different number per channel; the blended view alone would hide that. Shop (CM3) earns a tab despite being ~1% of revenue
         because it pays no fee, no ads and no postage and takes almost no returns — it reads as the clean margin the other two are
         measured against, and it sells a different brand mix. See routes/brand-overview.js for the full reasoning.

Guarded by AppShell. Consumes GET /brand-overview.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getBrandOverview, BrandOverviewRow } from '@/lib/api';

const WINDOWS = [12, 6] as const;

// The channels, sharing codes with Analytics -> Sales (All folds in every channel, so the two screens reconcile). Worth having
// here rather than only a blended view: Amazon takes an FBA fee out of every unit, so the same brand carries a different margin per
// channel and "which brands earn" has a different answer on each. 'Shop' is CM3, the physical shop — a tab on this screen only.
const CHANNELS = [
  { key: 'all', label: 'All channels' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
  { key: 'cm3', label: 'Shop' },
] as const;

// £ with thousands separators. Whole pounds — every figure on this screen is a year's or half-year's trade, where pennies are
// noise and the column is read for scale.
function money(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return (v < 0 ? '-£' : '£') + Math.round(Math.abs(v)).toLocaleString('en-GB');
}
// Percentages arrive already rounded to 1dp, or null where there was no divisor (see the route). null renders as an em dash, never
// as 0.0% — "we can't say" and "zero" are different answers.
function pct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Year-on-year change for the headline tiles (the per-brand ones are computed server-side). null when last year's window had
// nothing to compare against — same rule as the route, so the two never disagree about what "new" means.
function changePct(now: number, prior: number): number | null {
  if (!prior) return null;
  return Math.round(((now - prior) / Math.abs(prior)) * 1000) / 10;
}

// A year-on-year change, coloured by direction. null = last year's window had no trade at all, which reads as "new" rather than a
// made-up percentage — a brand's first season has nothing to be a percentage OF.
function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">new</span>;
  const up = value >= 0;
  return (
    <span className={'text-xs font-medium ' + (up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  );
}

export default function BrandsPage() {
  const [months, setMonths] = useState<number>(12);
  const [channel, setChannel] = useState<string>('all');
  // Others is collapsed by default — the whole point of the fold is that the tail isn't on screen until it's asked for.
  const [showOthers, setShowOthers] = useState(false);

  const { data, error, isLoading: loading } = useApiQuery(
    ['brand-overview', months, channel],
    () => getBrandOverview(months, channel),
  );
  const rows: BrandOverviewRow[] = data?.rows ?? [];
  const totals = data?.totals ?? null;

  // The share bar is scaled against the BIGGEST brand's revenue, not against the total: at a ~50% top share every other bar would
  // be a sliver of the width, and the column exists to compare brands with each other.
  const maxRevenue = rows.reduce((n, r) => Math.max(n, r.revenue), 0);

  return (
    <AppShell title="Brands" backHref="/analytics" backLabel="Reports">
      <details className="group mb-5 max-w-2xl">
        <summary className="cursor-pointer list-none text-sm text-slate-400 transition hover:text-slate-600">
          <span className="inline-flex items-center gap-1">
            What is this? <span className="transition group-open:rotate-180">▾</span>
          </span>
        </summary>
        <p className="mt-2 text-sm text-slate-500">
          What each brand earned over the window, next to the same period a year earlier (year-on-year, so the season is held
          constant — a summer against the winter before it would measure the season, not the brand). <strong>Revenue</strong> is what came
          in, <strong>Profit</strong> is what the downstream P&amp;L booked on those lines, and <strong>Margin</strong> is the ratio
          — the column worth reading first, because the biggest seller isn&apos;t always the biggest earner. Returns are included and
          netted off, so a brand that gets sent back a lot shows it here. Small brands fold into <strong>Others</strong>; open it to
          see what&apos;s inside.
        </p>
      </details>

      {/* WINDOW — two long options and nothing else (see the header). A segmented control rather than a dropdown: with two choices
          a dropdown hides half the answer behind a click. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {WINDOWS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonths(m)}
              className={
                'px-3 py-1.5 text-sm font-medium ' +
                (months === m ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              Last {m} months
            </button>
          ))}
        </div>
        {/* CHANNEL — a second segmented control beside the window, not a dropdown, for the same reason: three options that are
            each one word read faster laid out than folded away. */}
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChannel(c.key)}
              className={
                'px-3 py-1.5 text-sm font-medium ' +
                (channel === c.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              {c.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-slate-400">
            {fmtDate(data.from)} – {fmtDate(data.to)} · vs the same period last year ({fmtDate(data.priorFrom)} – {fmtDate(data.priorTo)})
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}

      {!loading && !error && data && totals && (
        <>
          {/* HEADLINE — the four numbers the whole table sums to, so the reader has the scale in hand before reading any row. */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-slate-400">Revenue (inc VAT)</div>
              <div className="text-xl font-semibold text-slate-900">{money(totals.revenue)}</div>
              <div className="mt-0.5"><Change value={changePct(totals.revenue, totals.priorRevenue)} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-slate-400">Net profit</div>
              <div className="text-xl font-semibold text-slate-900">{money(totals.profit)}</div>
              <div className="mt-0.5"><Change value={changePct(totals.profit, totals.priorProfit)} /></div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-slate-400">Margin</div>
              <div className="text-xl font-semibold text-slate-900">{pct(totals.marginPct)}</div>
              {/* Say the denominator on the tile. Profit is ex-VAT and revenue is gross, so the margin is deliberately NOT
                  profit/revenue as shown above it — without this line the two tiles look like they disagree. */}
              <div className="mt-0.5 text-xs text-slate-400">of {money(totals.netRevenue)} ex-VAT · {totals.brands} brands</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-wide text-slate-400">Units (net)</div>
              <div className="text-xl font-semibold text-slate-900">{totals.unitsNet.toLocaleString('en-GB')}</div>
              <div className="mt-0.5 text-xs text-slate-400">
                {totals.unitsSold.toLocaleString('en-GB')} sold · {totals.unitsReturned.toLocaleString('en-GB')} returned ({pct(totals.returnRatePct)})
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium" title="VAT-inclusive, as the customer paid">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium" title="Against the same period last year">vs LY</th>
                  <th className="px-3 py-2 text-right font-medium">Profit</th>
                  <th className="px-3 py-2 text-right font-medium" title="Against the same period last year">vs LY</th>
                  <th className="px-3 py-2 text-right font-medium" title="Profit / ex-VAT revenue — profit already has the VAT taken out, so the denominator does too">Margin</th>
                  <th className="px-3 py-2 text-right font-medium" title="Profit per net unit — returns already netted out">£/unit</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold less units returned, with returns as a share of units sold">Units</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.brand} className={r.isOthers ? 'bg-slate-50/70' : 'hover:bg-slate-50'}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">
                        {r.brand}
                        {/* The fold is only honest if what's inside it is one click away. */}
                        {r.isOthers && r.brands && (
                          <button
                            type="button"
                            onClick={() => setShowOthers((v) => !v)}
                            className="ml-2 text-xs font-medium text-brand-600 hover:underline"
                          >
                            {showOthers ? 'hide' : `${r.brands.length} brands`}
                          </button>
                        )}
                      </div>
                      {r.isOthers && showOthers && r.brands && (
                        <div className="mt-1 text-xs text-slate-500">{r.brands.join(' · ')}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">{money(r.revenue)}</div>
                      {/* Bar + share, scaled to the biggest brand (see maxRevenue). It carries the same number as the text beside
                          it — the point is reading the ORDER of magnitude down the column without comparing digits. */}
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={'h-full rounded-full ' + (r.isOthers ? 'bg-slate-300' : 'bg-brand-500')}
                            style={{ width: maxRevenue > 0 ? `${Math.max((r.revenue / maxRevenue) * 100, 1)}%` : '0%' }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{pct(r.revenueSharePct)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right align-top"><Change value={r.revenueChangePct} /></td>
                    <td className="px-3 py-2 text-right align-top font-medium text-slate-900">{money(r.profit)}</td>
                    <td className="px-3 py-2 text-right align-top"><Change value={r.profitChangePct} /></td>
                    {/* Margin is the read the screen exists for, so it gets the only conditional colour in the table: a brand
                        earning under 5% of its revenue is turning stock over, not making money. */}
                    <td className={
                      'px-3 py-2 text-right align-top font-medium ' +
                      (r.marginPct === null ? 'text-slate-400' : r.marginPct < 5 ? 'text-red-600' : 'text-slate-800')
                    }>
                      {pct(r.marginPct)}
                    </td>
                    <td className="px-3 py-2 text-right align-top text-slate-600">
                      {r.profitPerUnit === null ? '—' : money(r.profitPerUnit)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="text-slate-800">{r.unitsNet.toLocaleString('en-GB')}</div>
                      {r.unitsReturned > 0 && (
                        // Rate against units sold, so brands of different sizes are comparable — 20 returns means something very
                        // different on 100 sold than on 5,000.
                        <div className="text-xs text-slate-400">{r.unitsReturned} ret · {pct(r.returnRatePct)}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* FOOTNOTES — what the totals leave out, stated rather than buried. A number is only honest if its exclusions are on the
              same screen as it. */}
          <p className="mt-3 text-xs text-slate-400">
            {data.excluded.length > 0 && <>Excludes {data.excluded.join(', ')} entirely — no line, and not in the totals. </>}
            Brands under {data.othersSharePct}% of window revenue are folded into Others (recomputed per channel, so the row can
            hold different brands on each). {data.channel === 'all' && 'All channels includes the shop (CM3). '}
            {data.channel === 'cm3' && data.excluded.length > 0 && (
              /* Said out loud on this tab specifically: the exclusion is small online but takes a real bite out of the shop's own
                 trade, so a reader comparing the Shop tab with the till would otherwise be quietly misled. */
              <>The exclusion above bites harder here — it is one of the shop&apos;s better sellers, so these totals understate the
              shop. </>
            )}
            Returns are included and netted off both
            revenue and profit. Revenue is VAT-inclusive; margin is profit over ex-VAT revenue, because profit already has the VAT
            taken out of it.
          </p>
        </>
      )}
    </AppShell>
  );
}
