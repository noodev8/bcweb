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

NO MONEY ON THIS SCREEN (point 3 above). `total_profit_12m` is still returned and still stored in every snapshot, but it is not
shown: it is contribution before advertising, which invites exactly the "is that profit?" conversation the owner does not want to
have at a glance. The COUNT is the unit of progress here, not the pounds.

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
  const [notice, setNotice] = useState<string | null>(null);
  // Kept apart from the query's own error so a failed Update doesn't tear down a headline that loaded fine.
  const [actionError, setActionError] = useState<string | null>(null);

  const w = useApiQuery('portfolio-winners', () => getPortfolioWinners());
  // Loaded only for the "more on the way" box — the 99 rows behind it are never rendered.
  const c = useApiQuery('portfolio-contenders', () => getPortfolioContenders());

  const s = w.data?.summary;
  const history = w.data?.history ?? [];

  const count = s?.winnerCount ?? 0;
  const prior = s?.winnerCountPriorYear ?? 0;
  const delta = count - prior;

  async function onUpdate() {
    setUpdating(true);
    setNotice(null);
    setActionError(null);
    const res = await updatePortfolioSnapshot();
    if (res.success && res.data) {
      setNotice(`Recorded — ${res.data.summary.winnerCount} winners.`);
      await w.refresh();   // pull the series back with this point in it
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
      {notice && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
      {actionError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
      {w.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{w.error.message}</div>}

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
              <span className="text-7xl font-semibold tabular-nums leading-none text-slate-900 sm:text-8xl">
                {count.toLocaleString('en-GB')}
              </span>
              <p className="mt-3 text-lg text-slate-600">winners</p>
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
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Stat
            loading={w.isLoading}
            value={s?.winnerSharePct === null || s?.winnerSharePct === undefined ? '—' : `${s.winnerSharePct}%`}
            label="of the range"
            note={s ? `${count} of ${s.totalStyles} that sold this year` : undefined}
          />
          <Stat loading={w.isLoading} value={prior.toLocaleString('en-GB')} label="a year ago" note="same test, previous 12 months" />
          <Stat
            loading={w.isLoading}
            value={`${s?.joinedThisYear ?? 0} / ${s?.leftThisYear ?? 0}`}
            label="joined / dropped out"
            note="the movement behind the change"
          />
          <Stat
            loading={c.isLoading}
            value={(c.data?.summary.expectedWinners ?? 0).toLocaleString('en-GB')}
            label="more on the way"
            note={c.data ? `expected from ${c.data.summary.youngStyles} styles under 180 days old` : undefined}
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
        <WinnerTrendChart rows={history} />
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

function WinnerTrendChart({ rows }: { rows: PortfolioSnapshot[] }) {
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
        <span className="font-medium text-slate-600">Winners over time</span>
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
