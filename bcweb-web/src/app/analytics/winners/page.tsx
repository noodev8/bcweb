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

THE BAR IS GROSS REVENUE (£1,500 IN 12 MONTHS), NOT PROFIT — changed 2026-09-22, the owner naming the route this screen opens:
"PRODUCT FIND > REVENUE > PROFIT > KEEP/DROP. We have to keep loading and building our products with revenue. The rest are for
different departments to take care of." This screen is the FIND step and the count is its score. Profit here is contribution
BEFORE ad spend, so a profit bar quietly dropped thin-margin styles that sell brilliantly — exactly the products to load and
build — and pretended to a profitability answer it does not have. The margin question is the NEXT step, on its own screen. The
full argument and where £1,500 came from are on WINNER_BAR in bcweb-server/utils/portfolio.js. The dial below and the trend both
moved with it; the trend restarts from the change rather than plotting two rulers on one line (migrations/20260922d).

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

(That quote is from the profit era — the marks it names were £200/£300/£500/£1,000 of PROFIT. The dial works exactly as it
describes; only the metric underneath it changed.)

The toggle re-reads the WHOLE headline — count, share, revenue, units, last year, the brand split — at £1,500, £2,500, £5,000 or
£10,000 of revenue. Every one of those readings arrives in the SAME payload (summary.bars), so switching is instant and the four
can never disagree with each other. NOTHING THE TOGGLE DOES IS RECORDED: the trend line and the "Update now" button are welded to
the tracked £1,500 bar, because a series measured with a ruler that moves when someone is curious is not a series. The screen says so
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

THE ONE CARD THAT LEAVES THIS SCREEN: "added this year". Everything else here is a reading of the 80; this is the INPUT that
produces it — the products made this year against the same months last year, off product_event_log. It is the only figure on the
page the owner can move TODAY (the count itself answers six to twelve months later), which is why it earns a place and why it is
the only card that is a link: it goes to Reports -> New, where the month-by-month pace and the additions themselves live.

It reads the log, NOT skusummary.created_at, and the difference matters: product-delete hard-deletes the skusummary row, so a
style built in March and killed in June would read as though the work never happened. Months before the log went live
(2026-09-22) count survivors only and are a FLOOR — the New screen marks that boundary on its chart, which is another reason
this card is a doorway rather than a destination.

WHAT THE SHARE MEANS, AND THE GAP UNDER IT. "24% of the range" is 80 winners over the 329 styles that were part of the business
in the last 12 months — the catalogue as it stands, plus anything that traded and has since been deleted. The second half is the
owner's call (2026-09-22): "A product can come in for a month, do its job and leave. I clean the database but we have success."
A style that earned £518 over the winter and was then tidied away counts on both sides of the fraction.

THE DENOMINATOR USED TO BE "STYLES THAT TRADED IN THE WINDOW" AND THAT WAS WRONG. It dropped the 26 styles that sold nothing —
precisely the ones the owner needs in view: "I want to see how many Winners there are and how many (others) as such. Might be
losers, or might be new but I dont care. What is the gap between winners and our range." THE GAP IS THE OTHER HALF OF THE JOB —
"our other job apart from searching for new products is nurturing the existing ones" — so a denominator that hid the worst of it
could not measure the thing it exists to measure. Both definitions happen to give 303 today; they are different 303s (277
overlap), and the coincidence is not a reason to keep the flattering one.

THE TREND SHOWS BOTH LINES NOW, with the gap between them shaded: the range climbing as product is added, the winners climbing as
product matures, and whether the space between is opening or closing. That is the whole business in one picture, and it is why
the chart broke its own one-line rule — the second line is not a competing metric, it is the FIRST ONE'S DENOMINATOR.

Guarded by AppShell.Guarded by AppShell. Consumes GET /portfolio-winners, GET /portfolio-contenders and POST /portfolio-snapshot-update.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
import Link from 'next/link';
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

  // NOTE: "added" comes from GET /portfolio-winners, not from the New screen's trend route. It is a ROLLING 12 months there,
  // measured on the same ruler as the two figures beside it, and reading it here would cost a second round trip to get a
  // calendar-year answer to a rolling-window question. Reports -> New still owns the month-by-month pace.

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
          THE DIAL. Written as a SENTENCE with the marks inside it — "a winner turns over more than [£1,500] in 12 months" — the
          toggle is not a filter, it is the definition being read aloud, and a bare row of amounts would be a filter. It sits
          ABOVE the hero so the definition arrives before the number it produces.

          ALL FOUR MARKS LOOK THE SAME. Two earlier versions singled the tracked mark out — first with a line of explanatory text and a
          "Back to £200" button, then with colour and a larger size — and the owner removed both: "I only meant make the 200 the
          same as the other dials." It needs no flag because it is already where the dial sits when the page loads, which is
          what he sees every day without touching anything. Selection is the only state the marks show.
          --------------------------------------------------------------------------------------------------------------------- */}
      {bars.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm text-slate-500">A winner turns over more than</span>
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
          THREE HEADLINES: THE GOAL, WHAT WE HOLD, AND THE LEVER (owner, 2026-09-22 — "Intention is to drive us. We will be
          pushing to improve those is the point. then we look at the details, but thats after.")

            WINNERS  the goal.   Lags six to twelve months; you cannot push it directly.
            RANGE    what we hold. Mostly the scoreboard of the other two.
            ADDED    the lever.  The only one of the three that answers to what you do this week.

          THEY ARE NOT EQUAL AND THE LAYOUT SAYS SO. WINNERS takes half the width and prints at twice the size; the other two are
          headline-sized but visibly its siblings. The house rule still holds — one tracked metric is the hero — and the goal has
          to read first or the screen stops being about it.

          ⚠ THE SHARE IS A NOTE, NOT A BOX, AND MUST NEVER GROW AN ARROW. It was proposed as the middle headline and measured
            first: 24% today against 30% a year ago, i.e. DOWN in the best year on record (winners +22, range +134). It has to
            fall — 134 products arrived and a style takes one to two years to cross the bar (share by time on sale: 15% under 6m,
            8% at 6-12m, 24% at 1-2 years, 60% at 2+). A target that goes red when you do the right thing is worse than no target,
            and the only fast ways to lift it are to stop adding or to delete stock. It stays as small print under RANGE: shown,
            never driven.

            The honest quality guard is the MATURE share — winners among styles that have had a year or more on sale, 61 of 163 =
            37% today. That one is immune to how fast you add. It needs a snapshot column and a year of history before its
            direction means anything, so it is deliberately not here yet.
          --------------------------------------------------------------------------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:col-span-2">
          {w.isLoading ? (
            <div className="h-28 animate-pulse rounded bg-slate-100" />
          ) : (
            <>
              <span className="block text-7xl font-semibold tabular-nums leading-none text-slate-900 sm:text-8xl">
                {count.toLocaleString('en-GB')}
              </span>
              <p className="mt-3 text-xl text-slate-600">winners</p>
              <Delta value={delta} suffix="on last year" />
              <p className="mt-1 text-xs text-slate-400">{prior.toLocaleString('en-GB')} a year ago, same bar</p>
            </>
          )}
        </div>

        {/* `s`, not `sel`, for totalStylesPrior: it does not move with the dial. Declaring it on the per-bar type instead was a
            silent bug — it compiled and rendered 0, because the server sends it once on the summary. */}
        <Headline
          loading={w.isLoading}
          value={(sel?.totalStyles ?? 0).toLocaleString('en-GB')}
          label="range"
          delta={s ? s.totalStyles - s.totalStylesPrior : null}
          deltaSuffix="on last year"
          deltaNeutral
          note={
            sel
              ? `${sel.winnerSharePct === null ? '—' : `${sel.winnerSharePct}%`} are winners · ${sel.otherStyles.toLocaleString('en-GB')} others`
              : undefined
          }
        />

        {/* ROLLING 12 MONTHS, with this month as the note. A calendar-year version was briefly built and rejected: "We dont
            want calendar years. We said, we would use 12 month rolling?" It must not reset every January, and the two boxes
            beside it are rolling windows too. The month stays because it is the part that answers to this week.

            The only box that leads anywhere. Reports -> New has the month-by-month pace behind these numbers. */}
        <Headline
          loading={w.isLoading}
          value={(s?.addedYtd ?? 0).toLocaleString('en-GB')}
          label="added"
          delta={s ? s.addedYtd - s.addedYtdPrior : null}
          deltaSuffix="on the 12 months before"
          note={s ? `last 12 months · ${s.addedMtd.toLocaleString('en-GB')} this month` : undefined}
          href="/analytics/new-additions?from=/analytics/winners&back=Winners"
        />
      </div>

      {/* ---------------------------------------------------------------------------------------------------------------------
          AND THEN THE DETAIL — "then we look at the details, but thats after". Everything below qualifies the three above and is
          drawn at a size that says so.
          --------------------------------------------------------------------------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* WHICH NAMES CARRY THE COUNT. It shows winners and units together BECAUSE THEY DISAGREE, and that disagreement is the
            point: Birkenstock had 59 winners on 2,504 units while Lunar had 15 winners on 4,768. Count and volume are different
            businesses, and a bar drawn on winners alone would say Birkenstock is four times the story when by units it is half
            of it. Bars are scaled to the biggest brand's winner count, matching what the number beside them says. */}
        {brands.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between text-xs text-slate-400">
              <span>winners by brand</span>
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

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-1 lg:grid-rows-3">
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
          {/* Does not move with the dial, and the note says which bar it means. The conversion model behind it was fitted on
              "did the style clear the TRACKED bar within its first 365 days" (BANDS in utils/portfolio.js), so re-reading it at
              £10,000 would need a refit, not a filter. Naming the bar keeps it honest at £1,500 too.

              THE NOTE SAYS "WITHIN A YEAR" because the horizon is not obvious and the figure is large next to the count — 38
              against 74. That is real (33 styles actually joined this year, so the model is in the right place) but it reads as
              implausible without the horizon, and an unexplained number on a progress screen gets distrusted and then ignored. */}
          <Stat
            loading={c.isLoading}
            value={(c.data?.summary.expectedWinners ?? 0).toLocaleString('en-GB')}
            label="more on the way"
            note={
              c.data
                ? `expected to clear ${trackedBar === null ? 'the bar' : money(trackedBar)} within a year, from ${c.data.summary.youngStyles} styles under 180 days old`
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

// The year-on-year movement under a headline. Shared by all three boxes so one ruler and one set of words serve the lot:
// every figure on this screen is a rolling 12 months against the 12 months before it.
//
// GREEN AND RED ARE EARNED HERE and nowhere else on the page — WINNERS and ADDED are numbers the owner is pushing up, so
// direction is the whole message. Zero is neither: a flat year is a fact, not a failure.
//
// ⚠ `neutral` EXISTS FOR THE RANGE, and it is not decoration. A shrinking range is not a loss: "Deletions happen, as I do clean
//   the database and products. They are in the way and noise if I cant get any more" (owner, 2026-09-22). A style he can no
//   longer buy is removed ON PURPOSE, and painting that red would be the same mistake as targeting the share — a signal that
//   goes red when the right thing is done. The range reports its movement and passes no judgement on it.
function Delta({ value, suffix, neutral = false }: { value: number | null; suffix: string; neutral?: boolean }) {
  if (value === null) return null;
  const Icon = value === 0 ? MinusSmallIcon : value > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  const tone = neutral ? 'text-slate-400' : value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-slate-400';
  const textTone = neutral
    ? 'text-slate-500'
    : value > 0 ? 'font-medium text-emerald-700' : value < 0 ? 'font-medium text-red-700' : 'text-slate-500';
  return (
    <div className="mt-4 flex items-center gap-2 text-sm">
      <Icon className={`h-5 w-5 ${tone}`} />
      <span className={textTone}>
        {value === 0 ? `Level ${suffix}` : `${value > 0 ? '+' : ''}${value.toLocaleString('en-GB')} ${suffix}`}
      </span>
    </div>
  );
}

// One of the two smaller headlines beside WINNERS. Headline-sized so it reads as part of the top row, deliberately about half
// the hero's type size so it never becomes its peer. `href` makes the whole box a doorway — see Stat for why the affordance is
// a hover lift rather than a colour.
function Headline({
  loading,
  value,
  label,
  delta,
  deltaSuffix,
  deltaNeutral,
  note,
  href,
}: {
  loading: boolean;
  value: string;
  label: string;
  delta: number | null;
  deltaSuffix: string;
  deltaNeutral?: boolean;
  note?: string;
  href?: string;
}) {
  const body = loading ? (
    <div className="h-28 animate-pulse rounded bg-slate-100" />
  ) : (
    <>
      <span className="block text-4xl font-semibold tabular-nums leading-none text-slate-900">{value}</span>
      <p className="mt-2 text-base text-slate-600">{label}</p>
      <Delta value={delta} suffix={deltaSuffix} neutral={deltaNeutral} />
      {note && <p className="mt-1 text-xs leading-snug text-slate-400">{note}</p>}
    </>
  );
  const shell = 'block rounded-lg border border-slate-200 bg-white p-6 shadow-sm';
  if (!href) return <div className={shell}>{body}</div>;
  return (
    <Link href={href} className={`${shell} transition hover:border-slate-300 hover:shadow-md`}>
      {body}
    </Link>
  );
}

// A supporting figure. Small by construction — these exist to qualify the hero, and the moment one of them grows a table or a
// colour of its own it starts competing with the number it is meant to support.
//
// `href` makes one a doorway. The affordance is a border and a hover lift, NOT a colour or an arrow: a card that looked different
// from its neighbours would be claiming importance over them, and the point is that it is the same size of thing that happens to
// lead somewhere. The whole card is the target, so there is nothing small to aim at.
function Stat({
  loading,
  value,
  label,
  note,
  href,
}: {
  loading: boolean;
  value: string;
  label: string;
  note?: string;
  href?: string;
}) {
  const body = loading ? (
    <div className="h-12 animate-pulse rounded bg-slate-100" />
  ) : (
    <>
      <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{label}</div>
      {note && <div className="mt-1 text-xs leading-snug text-slate-400">{note}</div>}
    </>
  );

  const shell = 'block rounded-lg border border-slate-200 bg-white p-4 shadow-sm';
  if (!href) return <div className={shell}>{body}</div>;
  return (
    <Link href={href} className={`${shell} transition hover:border-slate-300 hover:shadow-md`}>
      {body}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The trend. TWO LINES — the range, and the winners inside it, with the gap between them shaded.
//
// This is not a relaxation of the one-metric rule, and the distinction matters or the chart will grow a third line next. The
// second line is not a competing measure: IT IS THE FIRST ONE'S DENOMINATOR. Winners alone cannot say whether a rising count
// means the business is converting better or simply got bigger, and the gap between the two is the owner's other job — "our
// other job apart from searching for new products is nurturing the existing ones" (2026-09-22). One picture: product going in
// at the top, winners coming through at the bottom, and whether the space between is opening or closing.
//
// Lightweight inline SVG, no chart library, matching Stock Position and Birk Availability.
//
// THE X AXIS IS THE SEQUENCE OF READINGS, NOT TIME. Points are recorded by hand, so they are irregularly spaced — two presses a day
// apart then a three-month gap is normal. Spacing them evenly makes the shape readable; each point carries its real date in the
// label and the tooltip, so nothing is hidden. Do not "fix" this into a date-proportional axis without first deciding what a
// three-month gap should look like.
//
// THE Y AXIS IS ZEROED. For a count the owner is trying to grow, a floating baseline turns ordinary wobble into a cliff — the whole
// point is to see the level, not a magnified slice of it.
// ---------------------------------------------------------------------------------------------------------------------------------
// Winners carry the blue — they are the tracked figure. The range is slate and recessive: a boundary for the shaded gap to sit
// under, not a second subject competing for the eye.
const TREND_COLOR = '#2a78d6';
const RANGE_COLOR = '#94a3b8';
const GAP_FILL = '#e2e8f0';

function WinnerTrendChart({ rows, trackedBar }: { rows: PortfolioSnapshot[]; trackedBar: number | null }) {
  const W = 720, H = 240, padL = 40, padR = 16, padT = 12, padB = 24;
  const n = rows.length;

  // Scaled to the RANGE, not the winners, so the gap is drawn at its true size. A chart scaled to the winners would push the
  // range line off the top and hide the very thing it is here to show.
  const maxY = Math.max(1, ...rows.map((r) => Math.max(r.totalStyles, r.winnerCount))) * 1.1;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);

  const winnerPts = rows.map((r, i) => `${x(i)},${y(r.winnerCount)}`).join(' ');
  const rangePts = rows.map((r, i) => `${x(i)},${y(r.totalStyles)}`).join(' ');
  // The gap, as one closed shape: along the range, back along the winners. A row that predates the totalStyles column stores 0
  // and would drag the band to the floor, so the shape is only drawn when every point has a real range.
  const haveRange = rows.every((r) => r.totalStyles > 0);
  const gapPath = haveRange
    ? `${rangePts} ${rows.map((r, i) => `${x(n - 1 - i)},${y(rows[n - 1 - i].winnerCount)}`).join(' ')}`
    : null;

  const first = rows[0];
  const last = rows[n - 1];
  const change = last.winnerCount - first.winnerCount;
  const gapChange = haveRange ? (last.totalStyles - last.winnerCount) - (first.totalStyles - first.winnerCount) : null;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-600">
          Winners over time{trackedBar === null ? '' : `, at the ${money(trackedBar)} bar`}
        </span>
        <span>
          {change === 0 ? 'Level' : change > 0 ? `Up ${change}` : `Down ${Math.abs(change)}`} since {shortDate(first.date)}
        </span>
        {/* The gap's own direction, stated rather than left to be eyeballed off a shaded band. Widening is not automatically
            bad — it is what adding product looks like — so this reports it and does not judge it. */}
        {gapChange !== null && gapChange !== 0 && (
          <span>gap {gapChange > 0 ? 'widened' : 'closed'} by {Math.abs(gapChange)}</span>
        )}
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded" style={{ backgroundColor: TREND_COLOR }} /> winners
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded" style={{ backgroundColor: RANGE_COLOR }} /> range
          </span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 460 }} role="img" aria-label="Winners against the whole range over time">
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

        {gapPath && <polygon points={gapPath} fill={GAP_FILL} />}
        {haveRange && <polyline points={rangePts} fill="none" stroke={RANGE_COLOR} strokeWidth={1.5} />}
        <polyline points={winnerPts} fill="none" stroke={TREND_COLOR} strokeWidth={2} />

        {rows.map((r, i) => (
          <circle key={r.date} cx={x(i)} cy={y(r.winnerCount)} r={4} fill={TREND_COLOR} stroke="#fff" strokeWidth={2}>
            <title>
              {`${r.date}: ${r.winnerCount} winners${r.totalStyles > 0 ? ` of ${r.totalStyles} — ${r.totalStyles - r.winnerCount} others${r.winnerSharePct === null ? '' : `, ${r.winnerSharePct}%`}` : ''}`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
