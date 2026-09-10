'use client';
/*
=======================================================================================================================================
Page: /analytics/ad-daily  (Reports — Ad Daily)
=======================================================================================================================================
Purpose: One row per day — what Google spent, what Shopify sold — over a short series, with one total across it. "Since I changed the
         budget, is the whole operation keeping money?"

WHAT THIS REPLACED, AND WHY (owner, 2026-09-10)
Ad Payback listed the styles that sold on one chosen day, each with a trailing 30-day Google verdict beside it. It was presented to
staff and could not be explained. The reason is worth keeping: every other list on this platform has a membership rule that IS the
job — WINNERS means price up, LOSERS means price down, TO PLACE means go and buy it, and the tab count is the queue that shrinks as
it is cleared. "Styles that happened to sell yesterday" is not a job, so there was nothing to tell anyone to do about it.

The 1-day/30-day mix everyone tripped over was a symptom of that, not the disease. It existed to paper over a real constraint: a
single day's ad spend cannot be attributed to a single style's sale. At BOOK level it does not need to be — the day's total spend
against the day's total profit is a legitimate pairing. So the mixing disappears by changing the grain, not the wording.

THIS IS AN OWNER SCREEN, NOT A STAFF SCREEN, AND THAT IS THE POINT
Staff act on STYLES, and the Google Ads screen already gives them a list they can clear, with the windows and the thin-shelf flag on
it. Budget-level "is the whole thing working" is the owner's decision. Trying to hand this to staff is what went wrong the first
time; the tile description says whose question it answers.

WHY IT EARNS A SCREEN AT ALL — IT IS FASTER THAN A MONTH AND WIDER THAN A STYLE
  - Reports -> Ad Efficiency is MONTHLY. August 2026 is one row at 8% kept. It cannot show that a change of course on 31 Aug worked,
    and would not show it until October.
  - The Google Ads grid has a d7 window, but it is per STYLE and never totals the book.
The gap is the day at book level, and the owner's own fortnight is the proof: 24-30 Aug ran £100+/day and kept -£98/-£16/+£26/-£11/
+£50/+£5/-£32; from 1 Sep spend fell to £18-£50/day and kept money almost every day — same stock, same styles. Visible here in six
days; nowhere else for another three weeks.

THERE IS NO `Kept` COLUMN ON A ROW. THIS IS DELIBERATE AND MUST NOT BE "FIXED"
Spend is smooth (it accrues over thousands of impressions) and units are a small integer count — 6.7/day over the fortnight to
6 Sep 2026, ranging 0 to 13. A per-row kept is therefore dominated by the randomness of the sales side: over that fortnight it swung
-£98 to +£103 on a business that netted £286 for the whole period. One day's "verdict" would be a third of the fortnight's result in
either direction, at random, and it would sit in the column the eye trusts most.

Sundays are worse and not randomly — 30 Aug 2026 drew the second-highest impressions of the fortnight and sold 3 units, because
Sunday is a browsing day and the buying lands midweek.

So the ROWS carry facts and the TOTAL carries the verdict. The total is the pinned top row of the table, and it keeps the visual
weight a hero number needs — heavier type, a tinted ground, Kept larger than anything below it. It sits ABOVE the days, in the same
columns, so comparing one day against the period is a glance up a column rather than a trip to a separate card. That is why the
summary card it replaced was dropped (owner, 2026-09-10): same figures, further from the thing they judge.

ONE WINDOW BREAKS THE ROWS-VS-TOTAL RULE AND IS OFFERED ANYWAY: at 2 days the total is barely more than a row, so it inherits a
row's noise. Kept the owner asked for it; it is a glance, not a verdict.

THE SCREEN CARRIES NO PROSE AT ALL (owner, 2026-09-10) — "I will just read the numbers and the columns are clear"
The page description, the staleness note and the whole explanatory footer were removed in one pass, along with the per-row "no ads"
chip and the total row's "ads ran N of M". What is left is a window switcher, five columns and a total.

BEFORE RE-ADDING ANY OF IT, note that each caveat was removed on a specific argument and not merely for tidiness:
  - "no ads" chip        — redundant beside a £0.00 in the very next cell.
  - "ads ran N of M"     — the owner's call: a zero spend figure is self-evidently a day without advertising, and they do not want
                           the total's denominator restated. This is the one with real information loss (a pause INSIDE the window
                           is not visible on the total, whose own spend is non-zero); it was flagged to the owner and overruled,
                           which is their call to make on their own screen.
  - staleness note       — derivable: the total row carries the date range, so a series ending yesterday is visible in it.
  - the footer           — explained returns, the Sales divergence and the rows-vs-total rule. All of it is still recorded HERE and
                           in the route header, which is where a maintainer will look. It is not lost, just not on screen.
The reasoning below all still governs the code; it simply is not printed any more.

A ZERO-SPEND DAY IS NOT MARKED ON THE ROW, AND (SINCE 2026-09-10) NOR IS IT COUNTED OUT ON THE TOTAL
The owner switched Google off from 7 Sep 2026 while re-planning. Those days are real, complete, and hold £0.00 — and a total that
spans them silently improves the longer the pause runs.

Both the per-row "no ads" chip and the TOTAL row's "ads ran N of M" note were dropped (owner, 2026-09-10). `adsRan` and
`daysWithAds` are still returned by the route and are still correct — nothing downstream was deleted, so restoring either is a
render-only change if the owner ever wants the denominator back.

THE SERIES ENDS AT THE LAST COMPLETE AD DAY, NOT TODAY
Sales land live; Google reports finished days, and its newest row is usually a part day. Running the list to today would put one to
three days at the TOP carrying sales with no spend beside them — every one reading as a spectacular day, none of them being one, in
the place the eye lands first. The footer says how far back the series necessarily ends.

RETURNS ARE EXCLUDED (`qty > 0`), which is the route's single deliberate disagreement with Analytics > Sales — a refund lands on
the day it came BACK, so it would be charged to advertising that ran weeks later, and every sale already carries a flat refund
allowance in its profit. Measured 7 Sep 2026: net-of-returns showed -2 sold / -£31.00 where the day truly sold 3 and kept £38.43.
The two screens now differ by exactly the refunds that landed in the window (£158 over the fortnight to 9 Sep 2026). The route
header carries the full argument and the precedent (birk-stock and the pricing bars already filter qty > 0).

NO DAY PICKER, NO DRILL, NO THIN-SIZES COLUMN. The picker invited reading one row as a verdict. Per-style detail belongs on the
Google Ads screen, which is where the owner works it. Thin-sizes spend is a large real leak (£449 of £947 over 24 Aug-6 Sep 2026)
but CANNOT honestly sit on a historic row: shelf depth is a fact about NOW, so topping up sizes next week would silently rewrite
every past row — the same category error as the 1-day/30-day mix. Making it honest needs a per-style daily size snapshot that was
costed and deliberately not built, because the Google Ads screen already covers the work.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { getAdDaily } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// Whole pounds on the summary — nobody reads a fortnight's takings to the penny. Two places in the grid, where days are compared
// against each other and £3 of difference is a real difference.
function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function money2(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`;
}

// The windows. 14 is the default and the one the screen was designed around: long enough for the total to mean something (91 units
// over the fortnight to 9 Sep 2026) and short enough to read without scrolling.
//   2  — yesterday and the day before (owner, 2026-09-10). The quick "what just happened" glance. It is the ONE window where the
//        total carries no more authority than a row, because it IS barely more than a row — at ~6.5 units/day, two days is a dozen
//        sales and the swing is the whole figure. Kept there is a fact to look at, not a verdict to act on.
//   7  — the week just gone. The fastest read on "did last week's budget change work", and the noisiest: at ~6.5 units/day a quiet
//        week and a bad week look identical, so it is a prompt to look, never an answer on its own.
//   30 — the working month. Enough sales that the total is solid; slow to show a change.
//   90 — the season. The route caps here on purpose: past 90 days a DAILY series is the wrong shape and Ad Efficiency's monthly
//        one is the right one, so there is deliberately no 180 or 365.
const WINDOWS = [2, 7, 14, 30, 90] as const;
const DEFAULT_DAYS = 14;

export default function AdDailyPage() {
  // Local state, not the URL: nothing on this screen links out or deep-links back in (that was Ad Payback's problem, and the reason
  // its day lived in the query string). SWR keys on the window, so switching back to one already fetched is instant.
  const [days, setDays] = useState<number>(DEFAULT_DAYS);

  const q = useApiQuery(['analytics-ad-daily', String(days)], () => getAdDaily(days));
  const d = q.data;
  const rows = d?.rows ?? [];
  const t = d?.totals;

  return (
    <AppShell title="Ad Daily" backHref="/analytics" backLabel="Reports">
      {/* ---- The window ------------------------------------------------------------------------------------------------------
          The summary card that used to sit here is gone (owner, 2026-09-10). It carried the same five figures the table's total row
          now carries, one card-width above them and in a different order — so the eye had to travel to compare a day against the
          period, which is the single comparison this screen exists to support. In the table they are one column apart.

          The date range moved with it, onto the total row, where it labels the figures it belongs to. */}
      <div className="mb-3">
        <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
                days === w ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {w} days
            </button>
          ))}
        </div>
      </div>

      {/* ---- The series ------------------------------------------------------------------------------------------------------
          Newest first: the recent days are the ones being judged, and a decision is read forwards from the bottom. */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Day</th>
                <th className="px-2 py-2 text-right font-semibold">Ad spend</th>
                {/* The share of the day's spend that reached a style which SOLD that day. Stated positively at the owner's request
                    (2026-09-10) because it is the number they intend to track upward.
                    A share and not the cash: the cash version is 0.97 correlated with Ad spend (it is that column again) and ranks
                    days backwards — 30 Aug carried £70.53 of non-selling spend and lost money, 24 Aug carried £99.85 and made it.
                    "Hit" rather than "Sale"/"Sold": the SOLD column two cells along counts units, and two columns whose names both
                    say "sold" meaning different things is how a number gets misread. */}
                <th className="px-2 py-2 text-right font-semibold">Hit %</th>
                <th className="px-2 py-2 text-right font-semibold">Clicks</th>
                <th className="px-2 py-2 text-right font-semibold">Sold</th>
                {/* Why a day was bad, where Kept only says that it was. Spend/units — derivable from its neighbours, but the
                    division is the finding and nobody does it while scanning. */}
                <th className="px-2 py-2 text-right font-semibold">Cost/sale</th>
                <th className="px-2 py-2 text-right font-semibold">Takings</th>
                {/* Kept, not Profit (owner, 2026-09-10): "that's what I'll be interested in". Profit before ads is recoverable on
                    any row as Kept + Ad spend, and the footer says so. */}
                <th className="px-4 py-2 text-right font-semibold">Kept</th>
              </tr>
            </thead>
            <tbody>
              {/* THE TOTAL, PINNED AT THE TOP OF ITS OWN COLUMNS.
                  It is the only figure on the screen that carries a verdict (a single day's Kept swings by more than a whole
                  period's result — see the header), so it keeps the visual weight the summary card used to give it: heavier type,
                  a tinted ground, and Kept larger than anything below it. Pinned ABOVE the rows, not below, because it is the
                  answer and the rows are the working — and because on a 90-day window a footer total would be off-screen. */}
              {t && !q.isLoading && !q.error && (
                <tr className="border-b-2 border-slate-300 bg-slate-50">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-slate-900">{t.days} days</div>
                    <div className="text-xs tabular-nums text-slate-500">{d?.from} to {d?.to}</div>
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">{money(t.spend)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                    {t.pctOnSellers === null ? '—' : `${t.pctOnSellers}%`}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">{t.clicks.toLocaleString('en-GB')}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">{t.units}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">
                    {t.costPerSale === null ? '—' : money2(t.costPerSale)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-slate-800">{money(t.revenue)}</td>
                  <td className={`px-4 py-2.5 text-right text-xl font-semibold tabular-nums ${t.kept < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {money(t.kept)}
                  </td>
                </tr>
              )}
              {q.isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {q.error && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-red-700">{q.error.message}</td></tr>
              )}
              {!q.isLoading && !q.error && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  No days in this period.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.day} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  {/* No "no ads" chip (owner, 2026-09-10): "if the cost was zero, that's clear to me". It was redundant sitting
                      beside a £0.00 in the very next cell. The greyed spend figure still marks the day quietly, and the TOTAL row
                      keeps its "ads ran N of M" note — that one is NOT derivable from anything on screen, because the total's own
                      spend is non-zero and hides the pause inside it. */}
                  <td className="px-4 py-2">
                    <span className="font-medium tabular-nums text-slate-800">{r.label}</span>
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.adsRan ? 'text-slate-700' : 'text-slate-300'}`}>
                    {money2(r.spend)}
                  </td>
                  <td
                    className="px-2 py-2 text-right tabular-nums text-slate-700"
                    title={
                      r.pctOnSellers === null
                        ? undefined
                        : `${money2(r.spendOnSellers)} of ${money2(r.spend)} reached a style that sold — ${r.stylesSold} of ${r.stylesCharged} charged styles`
                    }
                  >
                    {r.pctOnSellers === null ? '—' : `${r.pctOnSellers}%`}
                  </td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.adsRan ? 'text-slate-700' : 'text-slate-300'}`}>
                    {r.clicks.toLocaleString('en-GB')}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700">{r.units}</td>
                  {/* A dash when nothing sold: the value is undefined, and £0.00 would sort/scan as the cheapest day on screen. */}
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700">
                    {r.costPerSale === null ? '—' : money2(r.costPerSale)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-700">{money2(r.revenue)}</td>
                  {/* NOT coloured, deliberately. A red day here would read as a bad day and most red days are quiet days, not bad
                      ones — Sun 30 Aug 2026 (-£32.70) sat next to Mon 31 Aug (+£82.58) on identical advertising. Colour is a
                      verdict and only the total earns one.
                      A no-ads day shows its number like any other: nothing was spent, so all of it was kept. Nulling it here was
                      tried and reverted — it stopped the column adding up to the total above it, and the £0.00 spend cell and the
                      "no ads" chip already say why the figure is untouched. */}
                  <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-900">
                    {money2(r.kept)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </AppShell>
  );
}
