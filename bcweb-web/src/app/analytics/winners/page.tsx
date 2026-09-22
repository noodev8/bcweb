'use client';
/*
=======================================================================================================================================
Page: /analytics/winners  (Reports — Winners)
=======================================================================================================================================
Purpose: ONE NUMBER, ITS SHARE, AND WHETHER IT IS MOVING. The bird's-eye view of the business as a portfolio of earning assets —
         how many WINNERS there are, and whether that is growing or stalling.

  "Each product is a tiny asset that is earning for me. I want as many as I can get. That 20 should be 30 next year."
                                                                                                       — owner, 2026-09-22

THE WORD IS "WINNERS", EVERYWHERE IN THE UI. An earlier draft used "earning their keep" as the on-screen label, lifted from the
owner describing the screen in conversation; he ruled it out on 2026-09-22 ("that was just my casual wording — stick with
Winners"). Spoken shorthand is not interface vocabulary, and a screen that calls its metric something different from what the
module, the route and everyone in the building call it is a screen people have to translate.

AND THE WORD APPEARS EXACTLY ONCE, UNDER THE NUMBER. There is no page heading — the `title` prop is deliberately not passed to
AppShell. A heading at the top would say "Winners" before the figure does, which puts the label in front of the thing it labels
and splits the emphasis the big number is supposed to own.

THIS SCREEN IS A PROGRESS CHECK. NOTHING ON IT IS A TASK, AND NOTHING ON IT IS A LIST.
That sentence is the whole design, and it was arrived at by deleting things. The first build had two tabs: a WINNERS table of 80
rows (title, brand, earned, units, last year, a growing/flat/shrinking arrow, first sale, stock) and a CONTENDERS tab of 99 young
styles in six banded tables with an out-of-stock reorder queue on top. Both are gone. The owner, in order:

  1. "Contenders is too long with too much data. I'm not here to act on it. I'm here to check progress."
  2. "CONTENDERS is the job, but not here. I manage Birkenstock, Lunar and others elsewhere. This is the bird's-eye view of how
      we are progressing in building a big business."
  3. "I'm not sure I care about values. It is the amount before adverts? I don't care."
  4. "Do I want to see the actual list and figures? Growing, stalled? Not really. That's for another screen, not this one."
  5. "The big 80 in a big box and other values beside it in smaller boxes and progress/stall of the overall is my interest."

So: a big box, four small boxes, and a trend line. THE PER-STYLE DETAIL ALL STILL EXISTS ON THE API — GET /portfolio-winners
returns every winner and GET /portfolio-contenders every banded contender. This screen simply does not draw them. If a working
screen ever wants that detail, it is there; putting it back HERE is a regression, however useful it is in isolation.

GROSS REVENUE IS SHOWN; PROFIT IS NOT. The distinction is the owner's (2026-09-22): profit here is contribution BEFORE
advertising, which invites exactly the "is that really profit?" conversation he does not want at a glance — "I don't care about
values. It is the amount before adverts?" Gross revenue has no such ambiguity, so it earns a box. `total_profit_12m` is still
returned and still snapshotted, just not drawn. Revenue is NOT snapshotted (that would need a migration), so it is a live figure
only and deliberately absent from the trend line.

THE BAR IS A DIAL NOW, AND THE DIAL IS A READING ONLY (owner, 2026-09-22):

  "We have a number for winners based on making £200 profit in a year. I wonder, is it easy enough to give me a toggle so I can
   see what the numbers are for £300, £500 or 1k profit. I can then decide whether I'm focussing on high volume low profit items
   and what the sweet spot might be. Unless you can also give me a report here. ie. I shouldn't be focussing on the low 20 items
   if they only yield another £2 for the year."

The toggle re-reads the WHOLE headline — count, share, revenue, units, last year, the brand split — at £200, £300, £500 or
£1,000. Every one of those readings arrives in the SAME payload (summary.bars), so switching is instant and the four can never
disagree with each other. NOTHING THE TOGGLE DOES IS RECORDED: the trend line and the "Update now" button are welded to the
tracked £200 bar, because a series measured with a ruler that moves when someone is curious is not a series. The screen says so
in a line under the toggle whenever it is off the tracked bar — that line is not decoration, it is the guard-rail.

THE EARNINGS REPORT IS NOT ON THIS SCREEN. A "Where the earnings sit" table was built here on 2026-09-22 — the six rungs of the
range, what each earned, the typical £/unit, and a climbed-a-rung / slipped-a-rung line under it — and the owner removed it the
same day:

  "I dont want to show 'Where the earnings sit'. Its going to confuse my actions. Here, I want to see progress on product
   winners. I will be looking at that 80 and trying to improve it."

IT IS THE SAME DELETION AS ALL THE OTHERS. The winners table went, the contenders tables went, the per-style arrows went, the
money went — every time for the same reason, and every time the thing deleted was genuinely useful in isolation. This screen is
where he checks whether the count is growing. Anything that answers a DIFFERENT question, however good, competes with that one.

THE DATA IS STILL ON THE API, AND SO IS THE ANALYSIS. GET /portfolio-winners returns `summary.ladder` and `summary.movement`;
what they showed is written up in utils/portfolio.js (the profitLadder and bandMovement headers): there is no sweet spot between
£200 and £1,000, the £1,000+ cliff is a brand and a channel rather than a rung, big earners are grown not found, and 38 styles
climbed a rung this year against 41 that slipped. That work is DONE and recorded. If a screen ever needs it, it is a render
away — but it is not this screen.

WHAT THE SHARE MEANS. "26% of the range" is 80 winners over the 303 styles that sold anything in the last 12 months — same table,
same window, same filter as the count, so the two are on identical footing. Three other denominators were measured and all landed
at 25-27%, so the figure is robust and the choice is about which is easiest to say out loud, not which is right.

Guarded by AppShell. Consumes GET /portfolio-winners, GET /portfolio-contenders and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, MinusSmallIcon } from '@heroicons/react/24/outline';
import { useAuth } from '@/contexts/AuthContext';
import { getPortfolioWinners, getPortfolioContenders, updatePortfolioSnapshot, type PortfolioSnapshot } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// 'YYYY-MM-DD' -> '22 Sep'. Built from the string parts, never `new Date(...)` — these are pg DATEs cast to text precisely so that
// no timezone gets a chance to shift the day (CLAUDE.md). The DB session runs UTC and the box runs BST, so this matters.
// Whole pounds — this is a shape-of-the-business figure, and pence on £367,545 is noise.
function money(v: number): string {
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso || '—';
}

export default function WinnersPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <WinnersPageInner />
    </Suspense>
  );
}

function WinnersPageInner() {
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') || '/analytics';
  const backLabel = searchParams.get('back') || 'Reports';

  const { logout } = useAuth();
  const [updating, setUpdating] = useState(false);
  // Kept apart from the query's own error so a failed Update doesn't tear down a headline that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null);

  const w = useApiQuery('portfolio-winners', () => getPortfolioWinners());
  // Loaded only for the "more on the way" box — the 99 rows behind it are never rendered.
  const c = useApiQuery('portfolio-contenders', () => getPortfolioContenders());

  const s = w.data?.summary;
  const history = w.data?.history ?? [];

  // WHICH BAR IS ON SCREEN. null means "whatever the server tracks", so the default is never hard-coded here and follows
  // WINNER_PROFIT_BAR if it ever moves. It is view state and nothing more — no URL param, no storage, nothing sent anywhere.
  const [bar, setBar] = useState<number | null>(null);

  const bars = s?.bars ?? [];
  // bars[0] IS the tracked bar by construction (utils/portfolio.js spreads it onto the summary). Everything recorded — the trend
  // line, "Update now" — is measured there, whatever the toggle is showing.
  const trackedBar = bars[0]?.bar ?? s?.bar ?? null;
  // Fall back to the tracked bar, then to the summary itself, so a server that has not shipped `bars` still renders a headline.
  const sel = bars.find((b) => b.bar === bar) ?? bars[0] ?? s;

  const brands = sel?.byBrand ?? [];
  const topBrandWinners = Math.max(1, ...brands.map((b) => b.winners));

  const count = sel?.winnerCount ?? 0;
  const prior = sel?.winnerCountPriorYear ?? 0;
  const delta = count - prior;

  // NO SUCCESS BANNER (owner, 2026-09-22). A green "Recorded — 80 winners" bar was the first version and it was noise: the line
  // beside the button already changes to "N readings recorded, latest 22 Sep" the moment the refresh lands, and the trend gains a
  // point — the screen shows the result, so a banner announcing it is a second copy of an answer already on the page. FAILURE
  // still speaks, because that is the case with nothing to see.
  async function onUpdate() {
    setUpdating(true);
    setActionError(null);
    const res = await updatePortfolioSnapshot();
    if (res.success) {
      await w.refresh();   // pull the series back with this point in it — this IS the confirmation
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setActionError(res.error || 'Failed to record snapshot');
    }
    setUpdating(false);
  }

  // NO `title` PROP ON AppShell — deliberate (owner, 2026-09-22: "Remove winners from the top of the page too. Have it under
  // the big 80"). The screen names itself under the number instead, so the word appears once, attached to the figure it
  // describes, rather than twice with the heading version arriving first and stealing the emphasis. AppShell still renders the
  // back link without a title, so the "← Reports" arrow is unaffected.
  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      {actionError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
      {w.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{w.error.message}</div>}

      {/* ---------------------------------------------------------------------------------------------------------------------
          THE DIAL. Written as a SENTENCE with the marks inside it — "a winner earns more than [£200] in 12 months" — because the
          toggle is not a filter, it is the definition being read aloud, and a bare row of amounts would be a filter. It sits
          ABOVE the hero so the definition arrives before the number it produces.

          ALL FOUR MARKS LOOK THE SAME. Two earlier versions singled £200 out — first with a line of explanatory text and a
          "Back to £200" button, then with colour and a larger size — and the owner removed both: "I only meant make the 200 the
          same as the other dials." £200 needs no flag because it is already where the dial sits when the page loads, which is
          what he sees every day without touching anything. Selection is the only state the marks show.
          --------------------------------------------------------------------------------------------------------------------- */}
      {bars.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-slate-500">A winner earns more than</span>
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm">
            {bars.map((b) => (
              <button
                key={b.bar}
                onClick={() => setBar(b.bar)}
                aria-pressed={sel?.bar === b.bar}
                className={
                  sel?.bar === b.bar
                    ? 'rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white tabular-nums'
                    : 'rounded px-3 py-1.5 text-sm text-slate-600 tabular-nums transition hover:bg-slate-50'
                }
              >
                {money(b.bar)}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-500">in 12 months</span>
        </div>
      )}

      {/* ---------------------------------------------------------------------------------------------------------------------
          THE BIG BOX, AND THE SMALL ONES BESIDE IT. The hero takes half the width on a large screen and the four supporting
          figures sit in a 2x2 beside it, so the eye lands on the count first and everything else reads as qualification of it.
          House rule on headline hierarchy: ONE tracked metric is the hero and nothing else may grow into a peer of it.
          --------------------------------------------------------------------------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {w.isLoading ? (
            <div className="h-28 animate-pulse rounded bg-slate-100" />
          ) : (
            <>
              <span className="block text-8xl font-semibold tabular-nums leading-none text-slate-900 sm:text-[9rem]">
                {count.toLocaleString('en-GB')}
              </span>
              <p className="mt-3 text-xl text-slate-600">winners</p>
              <div className="mt-4 flex items-center gap-2 text-sm">
                {delta === 0 ? (
                  <MinusSmallIcon className="h-5 w-5 text-slate-400" />
                ) : delta > 0 ? (
                  <ArrowTrendingUpIcon className="h-5 w-5 text-emerald-600" />
                ) : (
                  <ArrowTrendingDownIcon className="h-5 w-5 text-red-600" />
                )}
                <span className={delta > 0 ? 'font-medium text-emerald-700' : delta < 0 ? 'font-medium text-red-700' : 'text-slate-500'}>
                  {delta === 0 ? 'Level on last year' : `${delta > 0 ? '+' : ''}${delta} on last year`}
                </span>
              </div>

              {/* WHICH NAMES CARRY THE COUNT. It fills the hero box (which was mostly white space) with the one breakdown that
                  qualifies the headline rather than competing with it — this is still the same 80, just split.

                  IT SHOWS WINNERS AND UNITS TOGETHER BECAUSE THEY DISAGREE, and that disagreement is the point: Birkenstock had
                  59 winners on 2,504 units while Lunar had 15 winners on 4,768. Count and volume are different businesses, and a
                  bar drawn on winners alone would say Birkenstock is four times the story when by units it is half of it.
                  Bars are scaled to the biggest brand's winner count, matching what the number beside them says. */}
              {brands.length > 0 && (
                <div className="mt-6 border-t border-slate-100 pt-4">
                  <div className="mb-2 flex items-baseline justify-between text-xs text-slate-400">
                    <span>by brand</span>
                    <span>units shifted</span>
                  </div>
                  <ul className="space-y-1.5">
                    {brands.map((b) => (
                      <li key={b.brand} className="flex items-center gap-3 text-sm">
                        <span className="w-24 flex-none truncate text-slate-600" title={b.brand}>{b.brand}</span>
                        <span className="w-6 flex-none text-right font-medium tabular-nums text-slate-900">{b.winners}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-slate-400"
                            style={{ width: `${Math.max(2, (b.winners / topBrandWinners) * 100)}%` }}
                          />
                        </span>
                        <span className="w-14 flex-none text-right tabular-nums text-slate-400">
                          {b.units.toLocaleString('en-GB')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-rows-2">
          {/* All four read off `sel`, so the whole headline moves with the dial rather than the count moving alone — a 29 sitting
              next to £367,545 of revenue earned by 80 styles would be a straightforwardly wrong screen. */}
          <Stat
            loading={w.isLoading}
            value={sel?.winnerSharePct === null || sel?.winnerSharePct === undefined ? '—' : `${sel.winnerSharePct}%`}
            label="of the range"
            note={sel ? `${count} of ${sel.totalStyles} that sold this year` : undefined}
          />
          <Stat
            loading={w.isLoading}
            value={sel ? money(sel.totalRevenue12m) : '—'}
            label="revenue"
            note="gross, last 12 months, from these winners"
          />
          <Stat
            loading={w.isLoading}
            value={(sel?.totalUnits12m ?? 0).toLocaleString('en-GB')}
            label="units shifted"
            note="packed and sent, last 12 months"
          />
          <Stat loading={w.isLoading} value={prior.toLocaleString('en-GB')} label="a year ago" note="same bar, previous 12 months" />
          {/* THIS ONE DOES NOT MOVE WITH THE DIAL, and the note says which bar it means. The conversion model behind it was
              fitted on "did the style clear the TRACKED bar in its first 180 days" (BANDS in utils/portfolio.js) — re-reading it
              at £1,000 would need a refit, not a filter, so it states its own bar instead of silently answering a different
              question. Naming the bar unconditionally keeps it honest at £200 too. */}
          <Stat
            loading={c.isLoading}
            value={(c.data?.summary.expectedWinners ?? 0).toLocaleString('en-GB')}
            label="more on the way"
            note={
              c.data
                ? `expected to clear ${trackedBar === null ? 'the bar' : money(trackedBar)}, from ${c.data.summary.youngStyles} styles under 180 days old`
                : undefined
            }
          />
        </div>
      </div>

      {/* PROGRESS OR STALL — the reason the snapshot table exists. Recording a point is a PRESS, never a side effect of viewing:
          a series that grew every time someone opened the page would measure browsing, not the business. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onUpdate}
          disabled={updating || w.isLoading}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {updating ? 'Recording…' : 'Update now'}
        </button>
        <span className="text-xs text-slate-400">
          {history.length === 0
            ? 'No readings recorded yet — press Update to start the trend.'
            : `${history.length} reading${history.length === 1 ? '' : 's'} recorded, latest ${shortDate(history[history.length - 1].date)}.`}
        </span>
      </div>

      {history.length > 1 ? (
        <WinnerTrendChart rows={history} trackedBar={trackedBar} />
      ) : history.length === 1 ? (
        <p className="text-xs text-slate-400">
          One reading so far ({history[0].winnerCount} on {shortDate(history[0].date)}). The trend appears once there are two.
        </p>
      ) : null}

    </AppShell>
  );
}

// A supporting figure. Small by construction — these exist to qualify the hero, and the moment one of them grows a table or a
// colour of its own it starts competing with the number it is meant to support.
function Stat({ loading, value, label, note }: { loading: boolean; value: string; label: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {loading ? (
        <div className="h-12 animate-pulse rounded bg-slate-100" />
      ) : (
        <>
          <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{label}</div>
          {note && <div className="mt-1 text-xs leading-snug text-slate-400">{note}</div>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The trend. ONE LINE, and it is the count — the same restraint as the hero: this screen tracks one number, and a chart with four
// series on it would quietly demote it. Lightweight inline SVG, no chart library, matching Stock Position and Birk Availability.
//
// THE X AXIS IS THE SEQUENCE OF READINGS, NOT TIME. Points are recorded by hand, so they are irregularly spaced — two presses a day
// apart then a three-month gap is normal. Spacing them evenly makes the shape readable; each point carries its real date in the
// label and the tooltip, so nothing is hidden. Do not "fix" this into a date-proportional axis without first deciding what a
// three-month gap should look like.
//
// THE Y AXIS IS ZEROED. For a count the owner is trying to grow, a floating baseline turns ordinary wobble into a cliff — the whole
// point is to see the level, not a magnified slice of it.
// ---------------------------------------------------------------------------------------------------------------------------------
const TREND_COLOR = '#2a78d6';

function WinnerTrendChart({ rows, trackedBar }: { rows: PortfolioSnapshot[]; trackedBar: number | null }) {
  const W = 720, H = 220, padL = 34, padR = 16, padT = 12, padB = 24;
  const n = rows.length;

  // Headroom so the line never runs along the top edge, and a floor of 1 so a series of zeroes still has a scale to draw on.
  const maxY = Math.max(1, ...rows.map((r) => r.winnerCount)) * 1.1;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const points = rows.map((r, i) => `${x(i)},${y(r.winnerCount)}`).join(' ');

  const first = rows[0];
  const last = rows[n - 1];
  const change = last.winnerCount - first.winnerCount;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        {/* The bar is named ON the chart, always — not only when the dial is off it. Every stored point was taken at the
            tracked bar and nothing in the table records that, so the label is the only thing standing between this line and
            someone reading it as the count they happen to be looking at. */}
        <span className="font-medium text-slate-600">
          Winners over time{trackedBar === null ? '' : `, at the ${money(trackedBar)} bar`}
        </span>
        <span>
          {change === 0 ? 'Level' : change > 0 ? `Up ${change}` : `Down ${Math.abs(change)}`} since {shortDate(first.date)}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 460 }} role="img" aria-label="Number of winners over time">
        {[0, Math.round(maxY / 2), Math.round(maxY)].map((v) => (
          <g key={`g${v}`}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          </g>
        ))}

        {rows.map((r, i) => {
          const step = Math.max(1, Math.ceil(n / 6));
          if (i % step !== 0 && i !== n - 1) return null;
          return <text key={`x${r.date}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{shortDate(r.date)}</text>;
        })}

        <polyline points={points} fill="none" stroke={TREND_COLOR} strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={r.date} cx={x(i)} cy={y(r.winnerCount)} r={4} fill={TREND_COLOR} stroke="#fff" strokeWidth={2}>
            <title>
              {`${r.date}: ${r.winnerCount} winners${r.winnerSharePct === null ? '' : ` — ${r.winnerSharePct}% of ${r.totalStyles}`}`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
