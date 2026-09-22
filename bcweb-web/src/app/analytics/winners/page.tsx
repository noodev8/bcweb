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

AND THEN THE REPORT, because a toggle alone answers the wrong half. Raising the bar tells you HOW MANY styles clear it; it cannot
tell you WHAT THE ONES IN BETWEEN ARE WORTH, which is the actual decision behind "I shouldn't be focussing on the low 20 items".
So "Where the earnings sit" cuts the same styles into bands and states each band's contribution. Measured 2026-09-22 it says:
the 29 styles between £200 and £300 are worth £6,886 a year BETWEEN THEM (13% of what the winners earn), while the 13 above
£1,000 are worth £25,553 — half of everything, from a sixth of the winners. The bottom of the list is not where the year is won.

AND THE COLUMN THAT ANSWERS "AM I CHASING HIGH VOLUME, LOW PROFIT": earned per unit, AS A MEDIAN. The first version of this
table showed the band aggregate and it produced a wrong answer — £7.79 / £7.43 / £10.16 / £5.72 across the winner rungs, which
reads as a sweet spot at £500-£1,000. There is no such spot. A couple of high-volume thin styles in each lower rung dominate its
denominator; on the TYPICAL style the same rungs are £10.89 / £10.44 / £12.44 / £4.75 — flat from £200 to £1,000, with one cliff
at the top. Draw the median. (utils/portfolio.js's profitLadder header has the full account; it is an easy mistake to repeat.)

WHAT THE CLIFF ACTUALLY IS: not a band, a BRAND. The £1,000+ rung is 7 Lunar and 6 Birkenstock and its three biggest are St Ives
colourways at ~£4.50 a unit, 85% of them on Amazon where the referral fee halves the take. It is a pricing fact, not a range one.

AND THE FINDING THAT REPLACED THE SWEET SPOT, which is the better one: BIG EARNERS ARE GROWN, NOT FOUND. Twelve of the thirteen
styles above £1,000 were already above £500 a year ago, and of 148 styles that first sold in the last 12 months, NONE reached
£1,000 and two reached £500. A style climbs a rung at a time over years — so the portfolio can add winners at the bottom every
year while the range it already owns quietly slides, and the headline count would not flinch. That is what "climbed a rung /
slipped a rung" under the table is for, and it is the one number here that the count cannot see.

THE REPORT IS A TABLE AND THAT IS NOT A BREACH OF THE RULE ABOVE. "Nothing on it is a list" means no per-style rows and no work
queue. Six bands are a SHAPE OF THE HERO NUMBER — the count, cut up — and the owner asked for exactly this. Per-style detail
still belongs elsewhere.

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
import {
  getPortfolioWinners,
  getPortfolioContenders,
  updatePortfolioSnapshot,
  type PortfolioSnapshot,
  type PortfolioProfitBand,
  type PortfolioBandMovement,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// 'YYYY-MM-DD' -> '22 Sep'. Built from the string parts, never `new Date(...)` — these are pg DATEs cast to text precisely so that
// no timezone gets a chance to shift the day (CLAUDE.md). The DB session runs UTC and the box runs BST, so this matters.
// Whole pounds — this is a shape-of-the-business figure, and pence on £367,545 is noise.
function money(v: number): string {
  return `£${Math.round(v).toLocaleString('en-GB')}`;
}

// Pence, for RATES only. A per-unit figure of £10.16 against £5.72 is the whole point of the ladder table and rounding it to
// whole pounds would collapse the comparison to "£10 against £6" — same story, but it reads as a rounding artefact.
function money2(v: number): string {
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A ladder band as words. `from` is an exclusive floor and `to` an inclusive ceiling, either of which may be null (open).
// The open-below band is NOT "under £0" — it is the styles that LOST money, and saying so is clearer than an inequality.
function bandLabel(from: number | null, to: number | null): string {
  if (from === null) return 'Lost money';
  if (to === null) return `${money(from)}+`;
  return `${money(from)} – ${money(to)}`;
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
  const offTracked = trackedBar !== null && sel !== undefined && sel.bar !== trackedBar;

  const brands = sel?.byBrand ?? [];
  const topBrandWinners = Math.max(1, ...brands.map((b) => b.winners));

  const count = sel?.winnerCount ?? 0;
  const prior = sel?.winnerCountPriorYear ?? 0;
  const delta = count - prior;

  const ladder = s?.ladder ?? [];

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

          THE TRACKED BAR IS MARKED WITH SIZE AND COLOUR, NOT WITH WORDS. It is the one read daily, so it is the only coloured,
          full-size mark and the rest are visibly peeks. A previous version said all this in a line of text under the dial and
          the owner deleted it — "all you have done is added EXTRA text and its confusing". Guide the click, do not explain it.
          The single clause that survives is the off-bar one: the trend does not follow the dial, and nothing else says so.
          --------------------------------------------------------------------------------------------------------------------- */}
      {bars.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-slate-500">A winner earns more than</span>
          <div className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1 shadow-sm">
            {bars.map((b) => {
              const isSel = sel?.bar === b.bar;
              // HOME IS THE ONLY MARK WITH A COLOUR AND THE ONLY ONE AT FULL SIZE. The tracked bar is what gets read daily;
              // the others are peeks. Guidance here is visual, not written — an earlier version explained the same thing in a
              // line of text under the dial and the owner cut it: "all you have done is added EXTRA text and its confusing."
              const isHome = b.bar === trackedBar;
              return (
                <button
                  key={b.bar}
                  onClick={() => setBar(b.bar)}
                  aria-pressed={isSel}
                  className={[
                    'rounded transition tabular-nums',
                    isHome ? 'px-4 py-1.5 text-lg font-semibold' : 'px-2.5 py-1 text-sm',
                    isSel && isHome ? 'bg-brand-600 text-white' : '',
                    isSel && !isHome ? 'bg-slate-700 text-white' : '',
                    !isSel && isHome ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 hover:bg-brand-100' : '',
                    !isSel && !isHome ? 'text-slate-500 hover:bg-slate-50' : '',
                  ].join(' ')}
                >
                  {money(b.bar)}
                </button>
              );
            })}
          </div>
          <span className="text-sm text-slate-500">in 12 months</span>
          {/* The ONE thing text still has to do here: the trend and the recorder do not follow the dial, and nothing else on
              the page says so. Only shown off-bar, and kept to a clause. */}
          {offTracked && <span className="text-xs text-slate-400">trend stays on {money(trackedBar as number)}</span>}
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

      {ladder.length > 0 && <EarningsLadder bands={ladder} movement={s?.movement ?? null} />}
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

// ---------------------------------------------------------------------------------------------------------------------------------
// WHERE THE EARNINGS SIT — the report half of the owner's question, and the reason the dial above is not enough on its own.
//
// A dial answers "how many clear £500". It cannot answer "is the bottom of my winners list worth working on", because that is a
// question about MONEY and a count contains none. These bands are the same styles cut up so each rung states its own contribution,
// and the arithmetic ties: the count at any mark on the dial is the sum of `styles` over the rungs above it.
//
// THREE COLUMNS, THREE DIFFERENT QUESTIONS, and the table is only worth drawing because they disagree:
//   earned         — what the rung is worth in a year. Answers "should I care about the bottom 29 at all".
//   typical £/unit — whether the rung earns because it is GOOD. THE MEDIAN, not the rung total over rung units: the aggregate is
//                    dominated by each rung's busiest styles and invented a sweet spot at £500-£1,000 that does not exist.
//   per style      — what one more product in that rung would be worth. The portfolio model's actual unit of decision.
//
// THE BELOW-THE-BAR RUNGS ARE DIMMED, NOT HIDDEN. 186 styles earning £14k between them is not a winner story, but it is the
// context for every "should I bother" question on this page, and the 37 that LOSE money are the only place on the screen they
// appear at all. They are greyed because they are not part of the count, not because they are unimportant.
//
// No colour, no accent, no badge. The emphasis is weight and dimming only — house rule, and a table of six rows that needed a
// key to read would be a worse table.
// ---------------------------------------------------------------------------------------------------------------------------------
function EarningsLadder({ bands, movement }: { bands: PortfolioProfitBand[]; movement: PortfolioBandMovement | null }) {
  const winnerBands = bands.filter((b) => b.isWinnerBand);
  // Bars are scaled across ALL rungs, including the dimmed ones, so the £0-£200 tail is visibly comparable to the winner rungs —
  // scaling to winners only would quietly hide that the tail out-earns the bottom two winner bands put together.
  const maxProfit = Math.max(1, ...bands.map((b) => Math.abs(b.profit)));

  // Everything said in words below is COMPUTED, never written down, so a caption cannot go stale the way a comment would.
  const bottom = winnerBands[0];
  const winnerProfit = winnerBands.reduce((a, b) => a + b.profit, 0);
  const bottomShare = winnerProfit > 0 && bottom ? Math.round((bottom.profit / winnerProfit) * 100) : null;

  // THE RATE READING, and it is deliberately NOT "which rung is best". An earlier version named the best rung and that framed a
  // sweet spot as a target; the honest read is that the rungs below the top are all much the same and the TOP one is different.
  // So: compare the top rung against the range of the ones beneath it, and only call it thin when it actually is.
  const top = winnerBands[winnerBands.length - 1];
  const lowerRates = winnerBands.slice(0, -1).map((b) => b.profitPerUnitTypical).filter((r): r is number => r !== null);
  const lowerMin = lowerRates.length ? Math.min(...lowerRates) : null;
  const lowerMax = lowerRates.length ? Math.max(...lowerRates) : null;
  const topIsThin = top?.profitPerUnitTypical !== null && top !== undefined && lowerMin !== null
    && (top.profitPerUnitTypical as number) < lowerMin;

  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium text-slate-600">Where the earnings sit</span>
        <span className="text-xs text-slate-400">every style that sold in the last 12 months, by what it earned</span>
      </div>

      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs font-normal text-slate-400">
            <th className="py-2 text-left">earned in 12 months</th>
            <th className="py-2 pl-4 text-right">styles</th>
            <th className="py-2 pl-4 text-right">earned</th>
            <th className="py-2 pl-3 text-left" />
            <th className="py-2 pl-4 text-right">units</th>
            {/* "typical" is doing real work in this header — it is what flags the figure as a median rather than the rung
                total over its units, which is the number that misleads. */}
            <th className="py-2 pl-4 text-right">typical £/unit</th>
            <th className="py-2 pl-4 text-right">per style</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => {
            // A single rule where the winners start, so the table SHOWS the bar rather than relying on the reader to hold it.
            const firstWinner = b.isWinnerBand && !bands[i - 1]?.isWinnerBand;
            const tone = b.isWinnerBand ? 'text-slate-900' : 'text-slate-400';
            return (
              <tr
                key={`${b.from}-${b.to}`}
                className={`border-b border-slate-100 last:border-0 ${firstWinner ? 'border-t-2 border-t-slate-300' : ''}`}
              >
                <td className={`py-2 ${b.isWinnerBand ? 'font-medium text-slate-700' : 'text-slate-400'}`}>
                  {bandLabel(b.from, b.to)}
                </td>
                <td className={`py-2 pl-4 text-right tabular-nums ${tone}`}>{b.styles.toLocaleString('en-GB')}</td>
                <td className={`py-2 pl-4 text-right tabular-nums ${tone}`}>{money(b.profit)}</td>
                <td className="py-2 pl-3">
                  {/* Width is on the ABSOLUTE value so the loss-making rung draws a bar at all; its minus sign in the column
                      beside it is what says which way it points. A 24px track keeps a tiny rung visible without implying it
                      is worth something. */}
                  <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                    <span
                      className={`block h-full rounded-full ${b.isWinnerBand ? 'bg-slate-400' : 'bg-slate-200'}`}
                      style={{ width: `${Math.max(2, (Math.abs(b.profit) / maxProfit) * 100)}%` }}
                    />
                  </span>
                </td>
                <td className={`py-2 pl-4 text-right tabular-nums ${tone}`}>{b.units.toLocaleString('en-GB')}</td>
                <td className={`py-2 pl-4 text-right tabular-nums ${tone}`}>
                  {b.profitPerUnitTypical === null ? '—' : money2(b.profitPerUnitTypical)}
                </td>
                <td className={`py-2 pl-4 text-right tabular-nums ${tone}`}>
                  {b.profitPerStyle === null ? '—' : money(b.profitPerStyle)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* THE SENTENCES THE TABLE IS FOR — the owner's own questions answered in his own terms, so the read does not depend on
          anyone scanning six rows of numbers to find it. All three are computed from the rows above. */}
      <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-500">
        {bottom && bottomShare !== null && (
          <p>
            The {bottom.styles} styles at {bandLabel(bottom.from, bottom.to)} earn {money(bottom.profit)} between them —{' '}
            {bottomShare}% of everything the winners earn, about {money(bottom.profitPerStyle ?? 0)} each for the year.
          </p>
        )}
        {top && top.profitPerUnitTypical !== null && lowerMin !== null && lowerMax !== null && (
          <p>
            {/* `top.from` not bandLabel(top) here — the label of an open-topped rung is "£1,000+", and "below £1,000+" is not
                a sentence. The floor is what "below" means. */}
            A winner earns about {money2(lowerMin)}–{money2(lowerMax)} a unit wherever it sits below {money(top.from ?? 0)}
            {topIsThin ? (
              <>
                {' '}— there is no rung that pays better. The break is at the top: {bandLabel(top.from, top.to)} earns{' '}
                {money2(top.profitPerUnitTypical)} a unit on {Math.round(top.unitsPerStyle ?? 0).toLocaleString('en-GB')} units a
                style. Those earn by volume, not margin.
              </>
            ) : (
              <>
                , and {bandLabel(top.from, top.to)} earns {money2(top.profitPerUnitTypical)}.
              </>
            )}
          </p>
        )}
        {/* CLIMBED / SLIPPED — the one thing here the winner count cannot see. A portfolio can add styles at the bottom every
            year while the range it already owns slides a rung, and 80 would not flinch. Net is stated because up and down alone
            invite reading whichever one suits. */}
        {movement && (
          <p className="text-slate-600">
            <span className="font-medium text-slate-900">
              {movement.up} styles climbed a rung this year, {movement.down} slipped one
            </span>{' '}
            (net {movement.net > 0 ? '+' : ''}{movement.net}, of {movement.styles} trading both years).{' '}
            {movement.topBandStyles > 0 && (
              <>
                {movement.topBandEstablished} of the {movement.topBandStyles} above {money(movement.topBandFloor)} were already
                above {money(movement.establishedFloor)} a year ago — big earners are grown, not found.
              </>
            )}
          </p>
        )}
        <p className="text-slate-400">Every figure here is before advertising.</p>
      </div>
    </div>
  );
}
