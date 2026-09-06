'use client';
/*
=======================================================================================================================================
Page: /analytics/ad-efficiency  (Reports — Ad Efficiency)
=======================================================================================================================================
Purpose: "Is Google still paying for itself?" One row per month, thirteen months back.

THE REPORT EXISTS BECAUSE OF A FAULT NOTHING ELSE WOULD HAVE CAUGHT
2026 grew on every measure the business normally watches — units, revenue, profit all up — while the share of that profit surviving
ad spend fell every month from March to August: 57, 54, 40, 21, 13, 8. Volume kept looking like success right until the margin was
gone, and the owner reports the same shape preceded a loss-making year two years earlier.

The Sales report says profit is up, which is true. The Google Ads screen works a 30-day window, which is too short to see a slide this
slow. A monthly series is the only shape this fault is visible in, and it is the whole reason for the page.

WHAT TO READ, AND WHAT TO IGNORE
`% kept` and `kept per unit` are scale-free and are the answer. Spend and profit are context. ABSOLUTE SPEND IS THE WRONG YARDSTICK
and misleads in both directions — it objects to a growing month where growing spend is correct, and it reassures in a quiet month
while efficiency collapses. That is exactly what September is doing: spend is down 87% from the June peak, and it is down because
summer ended, not because anything was fixed.

THE ALARM IS ANY MONTH UNDER 35%, shaded amber. The threshold lives HERE and not in the SQL, because it is a business judgement the
owner will want to move. A per-row up/down arrow against the previous month was tried and removed (owner, 2026-09-06): with the
months listed newest-first the eye already reads the decline down the column, and a marker on every falling row shouted on eleven
rows out of thirteen — which is no signal at all.

SOLD IS NET OF RETURNS (owner, 2026-09-06 — the column was called Units). SUM(qty) on Shopify sales, where a return is a negative
row and subtracts itself out. It has to be net: you cannot count a pair that came back, and the profit column is on the same basis,
so the two can never disagree.

THE CURRENT MONTH IS SHOWN AND GREYED, never hidden. Five days in, the ratios are violent (63% on 26 units) and would read as a
recovery. Dropping the row instead would leave the reader wondering where this month went.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import { getAdEfficiency } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// The line below which a month is worth stopping on. The owner's, not the data's — see the header.
const ALARM_PCT = 35;

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}

export default function AdEfficiencyPage() {
  const q = useApiQuery('analytics-ad-efficiency', () => getAdEfficiency());
  // Newest first (owner). The API returns oldest-first; nothing here compares a row to its neighbour, so a plain reverse is safe.
  const rows = (q.data?.months ?? []).slice().reverse();

  // The bar is drawn against the best month on screen rather than a fixed 100%, so the shape of the decline fills the column
  // instead of hugging the left edge. Settled months only — a partial month's ratio is not a real reading.
  const scale = Math.max(...rows.filter((r) => !r.partial).map((r) => r.pctKept ?? 0), 1);

  return (
    <AppShell title="Ad Efficiency" backHref="/analytics" backLabel="Reports">
      <div className="mb-4">
        <p className="text-sm text-slate-500">
          How much of each month&rsquo;s Shopify profit survived Google ad spend. Watch the share, not the spend — spend should rise
          in a good month.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Month</th>
                <th className="px-2 py-2 text-right font-semibold">Sold</th>
                <th className="px-2 py-2 text-right font-semibold">Profit</th>
                <th className="px-2 py-2 text-right font-semibold">Ad spend</th>
                <th className="px-2 py-2 text-right font-semibold">Kept</th>
                <th className="px-2 py-2 text-right font-semibold">Ad cost / sale</th>
                <th className="px-2 py-2 text-right font-semibold">Kept / sale</th>
                <th className="px-4 py-2 text-left font-semibold">% kept</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {q.error && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-red-700">{q.error.message}</td></tr>
              )}
              {rows.map((r) => {
                const alarm = !r.partial && r.pctKept !== null && r.pctKept < ALARM_PCT;

                return (
                  <tr key={r.month} className={`border-b border-slate-100 last:border-0 ${r.partial ? 'text-slate-400' : 'hover:bg-slate-50'}`}>
                    <td className="whitespace-nowrap px-4 py-2 font-medium">
                      {r.label}
                      {r.partial && <span className="ml-2 text-xs font-normal text-slate-400">so far</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.units.toLocaleString('en-GB')}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(r.profit)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(r.spend)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${!r.partial && r.kept < 0 ? 'text-red-600' : ''}`}>
                      {money(r.kept)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.adCostPerUnit === null ? '—' : `£${r.adCostPerUnit.toFixed(2)}`}</td>
                    {/* The most honest single figure on the page: what one pair actually left you after paying to sell it. */}
                    <td className={`px-2 py-2 text-right font-semibold tabular-nums ${
                      r.partial ? '' : r.keptPerUnit !== null && r.keptPerUnit < 0 ? 'text-red-600' : 'text-slate-900'
                    }`}>
                      {r.keptPerUnit === null ? '—' : `£${r.keptPerUnit.toFixed(2)}`}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-sm bg-slate-100">
                          <div
                            className={`h-full ${r.partial ? 'bg-slate-300' : alarm ? 'bg-amber-500' : 'bg-slate-800'}`}
                            style={{ width: `${Math.max(0, Math.min(100, ((r.pctKept ?? 0) / scale) * 100))}%` }}
                          />
                        </div>
                        <span className={`w-10 text-right tabular-nums ${alarm ? 'font-semibold text-amber-700' : ''}`}>
                          {r.pctKept === null ? '—' : `${r.pctKept}%`}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <p>
            <span className="font-medium text-slate-600">Watch the share, not the spend.</span> Spend should rise in a good month —
            it is the share of profit surviving it that says whether the growth is worth having.
          </p>
          <p>
            <span className="font-medium text-amber-700">Under {ALARM_PCT}%</span>, or a share falling month on month, is worth
            acting on. June 2026 did both, two months before the worst of it.
          </p>
          <p>
            Shopify sales only; profit is net of fees, postage and returns. The current month is partial and its ratios mean little
            until it closes.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
