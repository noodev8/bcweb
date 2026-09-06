'use client';
/*
=======================================================================================================================================
Page: /analytics/ad-payback  (Reports — Ad Payback)
=======================================================================================================================================
Purpose: "What sold today, and did it produce a positive take?" One row per style that sold on the chosen day, with the day's take
         beside whether that style is actually paying for its advertising.

WHY THIS IS A REPORT AND NOT A "TODAY" BUTTON ON THE GOOGLE ADS SCREEN (owner, 2026-09-06)
A one-day window was wanted there first. It does not work: on a normal day 50-100 styles draw ad spend and only 2-21 sell, so a
one-day GRID is ~95% rows reading "took spend, sold nothing", every one of which looks like a loser and almost none of which is.
Inverting it — list only what SOLD — makes those rows cease to exist. Three to six rows on a normal day, read in seconds.

It also must not live ON the Google Ads screen. That screen is anchored to the last COMPLETE day of ad data and its money bar says so
("30 days to 5 Sep"); a panel running to today sitting beside it would re-introduce exactly the confusion the anchor exists to
prevent. Two different questions, two different screens.

IT IS NOT THE SALES REPORT, AND THE TWO RECONCILE
Sales -> Today already lists the day's sale LINES, all channels, searchable, with a CSV export. This is style grain, Shopify only,
and adds the one column Sales cannot: Kept 30d. Everything else, Sales does better — so open this one when the question is about
Google, and Sales when it is about trade. They agree to the penny on a day with no refunds; on a day with refunds they differ by
exactly the refund-only styles this screen leaves out.

THE TWO COLUMNS ARE TWO DIFFERENT TIME PERIODS AND THE HEADINGS MUST SAY SO
The day's take is OURS and exact. The verdict is a 30-day trailing window, because same-day ad spend does not exist yet (the Google
import's newest day is a part day) and would be the wrong denominator anyway — a sale today can come from a click three days ago.
A 7-day spend column was built and cut on the same day: three time periods on one row is one more than reads.

READ `Kept 30d` AS THE VERDICT, NOT THE DAY'S PROFIT. A style can sell well today and still be underwater over the month — 0044791
RAMSES did exactly that on 6 Sep 2026, £6.75 earned on the day against -£13.91 kept over thirty. That gap is the entire reason the
two columns sit side by side.

RETURNS ARE NOT LISTED (owner, 2026-09-06). They are already carried in every profit figure here — utils/shopifyProfit.js books a
returns haircut against each sale — so the take is net of them whether or not a refund is drawn. A first cut listed them in a second
group and it doubled the length of a returns-heavy day with rows answering a different question.

THE SIZES COLUMN IS WHAT MAKES A ROW ACTIONABLE, AND IT IS THE ONLY CELL THAT IS NOT ABOUT THE CHOSEN DAY
A negative Kept 30d has three causes wanting three different actions, two of them opposite: an EMPTY SHELF wants pausing (repricing
changes nothing — the shopper's size is not there), a THIN MARGIN on a full shelf wants pricing UP, and poor conversion on a full
shelf is a price/listing problem. Without the size count the first two are indistinguishable. Real example from 24 Aug 2026:
1030447-ARIZONA kept -£39.51 on 1 of 6 sizes (pause) sat two rows from 1016145-GIZEH keeping -£17.77 on 6 of 7 (reprice).

THIN_SIZES matches the Google Ads screen exactly — see that page's constant for the evidence. Conversion nearly TRIPLES the moment
a fifth size is buyable, so the flag is an absolute count, not a share of the run. It reads TODAY'S shelf even on a back-dated day,
because stock history is not kept and "can a shopper buy this now" is a fact about now; the footnote says so rather than pretending.

THE ROW LINKS TO THE PRICE SETTER, AND CARRIES THE COOLDOWN WITH IT
/pricing/style/[groupid] is already the decision screen, so the row opens it with ?from= pointing back at this day. That is also why
the chosen day lives in the URL rather than in component state: apply a price and the back link has to return to the day you were
reading, not to today. The review chip is a WARNING, not a block — this report deliberately ignores Pricing's cooldown (it answers a
different question), but following the link through to a style a colleague parked yesterday and re-pricing it unaware is a real way
to tread on someone, so the row says when it is parked.

THE DAY PICKER MOVES THE VERDICT WITH IT. Looking at last Tuesday shows last Tuesday's sales against the 30 days as they stood THEN.
Judging a historical day by a window it could not have known about would make looking back pointless, which is the only reason the
picker is here.
=======================================================================================================================================
*/

import { Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeftIcon, ChevronRightIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getAdPayback } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// Whole pounds in the summary (nobody reads a day's takings to the penny), two places in the grid where a row is being judged.
function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}
function money2(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`;
}

// The shelf-depth line, matching the Google Ads screen's constant of the same name. Kept as its own literal rather than imported
// from that page: it is a business threshold on a page-level constant, and a cross-page import would tie two screens' layouts
// together for one number. If one moves, move both — the evidence behind it lives in a comment on the Google Ads page.
const THIN_SIZES = 5;

// Date arithmetic on the 'YYYY-MM-DD' STRING, never via a JS Date. Constructing a Date from it parses as UTC midnight and printing
// it back applies the local offset, which under BST moves the day (CLAUDE.md). The whole screen is one day wide, so a one-day shift
// is not a rounding error — it is the entire answer.
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}
function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function AdPaybackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The day lives in the URL, not in state: the row links out to the price setter and has to be able to send the operator back to
  // the day they were reading. Absent = "whatever the server calls today", so a first load does not depend on the browser's clock
  // agreeing with the server's.
  const day = searchParams.get('day');
  const setDay = useCallback((d: string | null) => {
    router.replace(d ? `/analytics/ad-payback?day=${d}` : '/analytics/ad-payback', { scroll: false });
  }, [router]);

  const q = useApiQuery(['analytics-ad-payback', day ?? 'today'], () => getAdPayback(day ?? undefined));
  const d = q.data;

  const today = todayLocal();
  // Before the first response lands there is no server day to step from, so the arrows fall back to the browser's date. They agree
  // in every case that matters (both Europe/London) and the response corrects the label the moment it arrives.
  const current = d?.day ?? day ?? today;
  const atToday = current >= today;

  const rows = d?.rows ?? [];

  // Where the price setter sends the operator back to. Encoded because it carries its own query string.
  const backTo = encodeURIComponent(day ? `/analytics/ad-payback?day=${day}` : '/analytics/ad-payback');

  return (
    <AppShell title="Ad Payback" backHref="/analytics" backLabel="Reports">
      <div className="mb-4">
        <p className="text-sm text-slate-500">
          What sold on one day, and whether each of those styles is paying for its Google advertising. Shopify sales only.
        </p>
      </div>

      {/* ---- Day picker + the day's take ------------------------------------------------------------------------------------- */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDay(shiftDay(current, -1))}
              className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
              aria-label="Previous day"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <input
              type="date"
              value={current}
              max={today}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm tabular-nums text-slate-900"
            />
            <button
              type="button"
              onClick={() => setDay(shiftDay(current, 1))}
              disabled={atToday}
              className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next day"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
            {!atToday && (
              <button
                type="button"
                onClick={() => setDay(null)}
                className="ml-1 rounded-md px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Today
              </button>
            )}
          </div>

          {/* The day's net profit is the hero — it is the question the screen was opened to answer. Sold and takings are supporting
              detail and are sized as such. */}
          <div className="flex items-end gap-6">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Sold</div>
              <div className="text-lg font-medium tabular-nums text-slate-700">{d ? d.totals.units : '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Takings</div>
              <div className="text-lg font-medium tabular-nums text-slate-700">{d ? money(d.totals.revenue) : '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Profit</div>
              <div className={`text-3xl font-semibold tabular-nums ${d && d.totals.profit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {d ? money(d.totals.profit) : '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {d && (
            <>
              <span className="font-medium text-slate-600">{d.dayLabel}</span>
              {d.isToday && <span className="ml-2">still trading — the day is not final</span>}
              <span className="mx-2 text-slate-300">|</span>
              Kept 30d covers {d.verdictFrom} to {d.verdictTo}
              {/* Staleness is stated, never hidden: the verdict stops at the last day the ad feed has finished watching. */}
              {d.adDaysOld > 0 && (
                <span className="ml-1 text-slate-400">
                  — ad data is {d.adDaysOld} day{d.adDaysOld === 1 ? '' : 's'} behind this day
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- The day ---------------------------------------------------------------------------------------------------------- */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2 text-left font-semibold">Style</th>
                <th className="px-2 py-2 text-right font-semibold">Sold</th>
                <th className="px-2 py-2 text-right font-semibold">Takings</th>
                <th className="px-2 py-2 text-right font-semibold">Profit</th>
                {/* The only column that describes TODAY rather than the chosen day — see the header. */}
                <th className="px-2 py-2 text-right font-semibold">Sizes</th>
                {/* The heading has to carry the window, because this half of the row is a different period from the half beside it. */}
                <th className="px-2 py-2 text-right font-semibold text-slate-400">Ad spend 30d</th>
                <th className="px-2 py-2 text-right font-semibold text-slate-400">Profit 30d</th>
                <th className="px-4 py-2 text-right font-semibold">Kept 30d</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              )}
              {q.error && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-red-700">{q.error.message}</td></tr>
              )}
              {!q.isLoading && !q.error && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                  Nothing sold on this day.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.groupid} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    {/* Straight to the price setter, which is the action most of these rows lead to.
                        NEW TAB on purpose, matching the NavPill convention in GoogleAdsDrill: the operator is working DOWN a day's
                        list, and navigating away would lose their place in it — they would come back to the top of a screen they
                        were half through. `from` still carries the day, so the new tab lands back on the right day after an Apply
                        rather than on the pricing module's own front door. */}
                    <Link
                      href={`/pricing/style/${encodeURIComponent(r.groupid)}?from=${backTo}`}
                      target="_blank"
                      rel="noopener"
                      className="group inline-flex items-center gap-1.5 font-medium text-slate-900 hover:text-slate-600"
                    >
                      <span className="underline decoration-slate-300 underline-offset-2 group-hover:decoration-slate-600">
                        {r.title || r.groupid}
                      </span>
                      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 flex-none text-slate-400" />
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-slate-400">{r.groupid}</span>
                      {/* A warning, never a block: this report ignores Pricing's cooldown on purpose, but the link above reaches
                          the price setter, and re-pricing a style a colleague parked yesterday should not happen unknowingly. */}
                      {r.nextReview && (
                        <span
                          className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500"
                          title={`Pricing review set for ${r.nextReview} — parked in triage until then`}
                        >
                          review {r.nextReview}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.units}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money2(r.revenue)}</td>
                  <td className={`px-2 py-2 text-right font-medium tabular-nums ${r.profit < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {money2(r.profit)}
                  </td>
                  {/* Buyable sizes out of the listed run. Amber under THIN_SIZES, where conversion collapses. sizesListed 0 means
                      the style is not in skumap at all — a data gap, which renders as a dash and must NOT also wear the warning
                      colour, or two different faults become one number. */}
                  <td
                    className={`px-2 py-2 text-right tabular-nums ${
                      r.sizesListed > 0 && r.sizesInStock < THIN_SIZES ? 'font-medium text-amber-700' : 'text-slate-600'
                    }`}
                    title={
                      r.sizesListed === 0
                        ? 'Not in skumap — no size run recorded'
                        : `${r.sizesInStock} of ${r.sizesListed} sizes buyable today${
                            r.sizesInStock < THIN_SIZES ? ` — under ${THIN_SIZES}, where clicks stop converting. Pausing beats repricing.` : ''
                          }`
                    }
                  >
                    {r.sizesListed === 0 ? '—' : `${r.sizesInStock}/${r.sizesListed}`}
                  </td>
                  {/* Greyed: these two are the working out, not the answer. */}
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{money2(r.spend30)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{money2(r.profit30)}</td>
                  {/* The verdict. Red is the whole point of the screen: it sold today AND it is not paying for itself. */}
                  <td className={`px-4 py-2 text-right font-semibold tabular-nums ${r.kept30 < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                    {money2(r.kept30)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <p>
            <span className="font-medium text-slate-600">Profit is the day. Kept 30d is the verdict.</span> A style can sell well
            today and still be underwater over the month — that gap is why both are here.
          </p>
          <p>
            Same-day ad spend is deliberately absent: the Google import&rsquo;s newest day is a part day, and a sale today can come
            from a click three days ago. Thirty days is the shortest window where the spend means anything.
          </p>
          <p>
            <span className="font-medium text-amber-700">A thin shelf is not a price problem.</span> Under {THIN_SIZES} buyable
            sizes, clicks stop converting whatever the price — pause those rather than repricing them. A full shelf still losing
            money is the one to reprice. Sizes are TODAY&rsquo;s stock even on an earlier day; stock history is not kept.
          </p>
          <p>
            Style names open the price setter in a new tab, so you keep your place in the day. Shopify sales only, profit net of
            fees, postage and returns. Returns are not listed — they are already taken off these
            profit figures. This screen only shows what SOLD: a style burning money having sold nothing is on the Google Ads
            losers list, not here.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

// useSearchParams needs a Suspense boundary in the App Router, the same wrap the pricing drill uses.
export default function AdPaybackPage() {
  return (
    <Suspense fallback={<AppShell title="Ad Payback" backHref="/analytics" backLabel="Reports"><div className="py-10 text-center text-sm text-slate-400">Loading…</div></AppShell>}>
      <AdPaybackInner />
    </Suspense>
  );
}
