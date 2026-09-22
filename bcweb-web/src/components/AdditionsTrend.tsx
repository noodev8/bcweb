'use client';
/*
=======================================================================================================================================
Component: AdditionsTrend  (the PRODUCTION panel on Reports -> New)
=======================================================================================================================================
Purpose: How much new product we are making, and how the pace through this year compares with last. The list on the screen below
         answers "what did we add lately and is it selling"; this answers the different question of OUTPUT — the rate at which new
         lines get built.

Why monthly bars and not a cumulative line: the months are violently lumpy (2026 ran Feb 0, Mar 22, Jun 30, Aug 3) and in a business
that buys a season at a time, THAT IS THE FINDING — it is the shape of when the work actually happens. A running total smooths the
exact thing worth seeing. The pace question (are we ahead of last year) is answered in words by the headline above the chart, so the
chart is free to show the shape instead of saying the same thing twice. Each month shows last year beside this year, so a heavy month
can be read against its own counterpart rather than against the year's average.

Counted from product_event_log, which keeps the event after the product is deleted — so a line that was built and later killed still
counts as work done (skusummary.created_at only ever shows survivors). Months before the log was installed are backfilled from the
catalogue and therefore survivors-only; the owner's call is that this does not need saying on screen.

THE YEAR TARGET, AND WHY IT IS A YEAR AND NOT A MONTH. The owner asked for a target to "keep looking/adding" — "This is our
business. Not finding customers (Amazon and Google do that). We find products and build our portfolio." A MONTH-ON-MONTH target
was considered and rejected on the numbers: 2026 ran 5, 0, 22, 8, 15, 30, 22, 3, 16 — mean 15, sd 9, and three zero months in
2025. July to August would read as "down 87%" when nothing was wrong, and a target that cries wolf every other month is one you
stop reading. It is also partial for most of a month: on the 2nd you would be "behind" by construction. A year-to-date figure
against a year number only ever goes up, so a quiet August does not dent it and a heavy month visibly moves it.

200 IS THE OWNER'S NUMBER, set 2026-09-22, not a computed one — a target nobody chose is a score, not a target. For context when
it is next reviewed: 121 by late September against 40 in the whole of 2025, and the measured first-year hit rate is 10-13% (9 of
94 for the 2024 cohort, 4 of 30 for 2025), rising to ~26% by year two as styles climb. So 200 additions is worth roughly 20-25
winners in their first year and more later — which is the arithmetic that makes it a target for the Winners count rather than a
production quota.

Loads independently (own useApiQuery) so a slow trend never holds up the list. Consumes GET /analytics-new-additions-trend.
=======================================================================================================================================
*/

import { useApiQuery } from '@/lib/useApiQuery';
import { getNewAdditionsTrend, AdditionsTrendYear } from '@/lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// This year vs last. Blue carries the year being steered; last year is slate and deliberately recessive — a reference line, not a
// second subject competing for the eye.
const NOW_COLOR = '#2a78d6';
const PREV_COLOR = '#cbd5e1';

// New products to build this calendar year. THE OWNER'S NUMBER (2026-09-22), not a fitted one — see the header for the context to
// review it against. It is a display target and touches nothing else: no alert, no colour change, no email when it slips.
const YEAR_TARGET = 200;

// Running total across a year's 12 months.
function cumulative(y: AdditionsTrendYear): number[] {
  let run = 0;
  return y.months.map((m) => (run += m.created));
}

export default function AdditionsTrend() {
  const { data, error, busy } = useApiQuery(['new-additions-trend'], () => getNewAdditionsTrend());

  if (busy && !data) return <p className="mb-6 text-sm text-slate-400">Loading production trend…</p>;
  if (error || !data || data.years.length === 0) return null; // the list below is the main event — a failed trend stays silent

  const years = data.years;
  const cur = years[years.length - 1];
  const prev = years.length > 1 ? years[years.length - 2] : null;
  const curCum = cumulative(cur);
  const prevCum = prev ? cumulative(prev) : null;
  const through = Math.min(12, Math.max(1, data.throughMonth));

  // Running totals are no longer plotted (the chart is monthly bars), but they still drive the headline: this year against last year at
  // the SAME point, not against its full twelve months. Comparing a part-year with a whole one is the easiest way to look behind when
  // you are ahead.
  const ytd = curCum[through - 1];
  const prevAtSamePoint = prevCum ? prevCum[through - 1] : null;
  const delta = prevAtSamePoint === null ? null : ytd - prevAtSamePoint;
  const deleted = years.reduce((s, y) => s + y.months.reduce((t, m) => t + m.deleted, 0), 0);

  // Progress against the year. `through` counts the current month as elapsed, so the months LEFT are the whole ones after it —
  // which makes the required rate slightly demanding rather than slightly flattering, the right way round for a target. Guarded
  // for December, where there is no "rest of the year" to divide by.
  const toGo = Math.max(0, YEAR_TARGET - ytd);
  const monthsLeft = Math.max(0, 12 - through);
  const perMonth = monthsLeft > 0 ? Math.round(toGo / monthsLeft) : null;
  const targetPct = Math.min(100, Math.round((ytd / YEAR_TARGET) * 100));

  // Geometry: 12 equal month bands, each holding last year's bar then this year's. Bars are sized off the band so the chart keeps
  // working if the month count ever changes.
  const W = 720, H = 200, padL = 32, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / 12;
  const barW = Math.min(16, (band - 6) / 2);
  const maxY = Math.max(1, ...cur.months.map((m) => m.created), ...(prev ? prev.months.map((m) => m.created) : [0]));
  const bandX = (i: number) => padL + i * band;           // left edge of month i's band
  const centre = (i: number) => bandX(i) + band / 2;
  const y = (v: number) => padT + (1 - v / maxY) * plotH; // top edge of a bar of height v
  const barH = (v: number) => (v / maxY) * plotH;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Products made in {cur.year}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-bold leading-none tabular-nums text-slate-900">{ytd}</span>
            {delta !== null && prev && (
              <span className="text-sm text-slate-500">
                {delta === 0 ? (
                  <>level with {prev.year} at this point</>
                ) : (
                  <>
                    <strong className="font-semibold text-slate-700">{delta > 0 ? '+' : ''}{delta}</strong>
                    {' '}vs {prev.year} at this point ({prevAtSamePoint})
                  </>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded" style={{ backgroundColor: NOW_COLOR }} /> {cur.year}
          </span>
          {prev && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded" style={{ backgroundColor: PREV_COLOR }} /> {prev.year} ({prev.total} all year)
            </span>
          )}
        </div>
      </div>

      {/* THE TARGET. A bar and one line, directly under the figure it measures — not a box of its own, which would make the
          screen answer "how are we doing" twice. The bar carries this year's blue so it reads as the same subject as the chart. */}
      <div className="mt-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <span className="block h-full rounded-full" style={{ width: `${targetPct}%`, backgroundColor: NOW_COLOR }} />
        </div>
        <div className="mt-1.5 text-xs text-slate-500">
          <strong className="font-semibold text-slate-700">{ytd} of {YEAR_TARGET}</strong> for the year
          {toGo === 0 ? (
            <> — target met.</>
          ) : perMonth === null ? (
            <> · {toGo} to go.</>
          ) : (
            <> · {toGo} to go over the {monthsLeft} month{monthsLeft === 1 ? '' : 's'} left, about {perMonth} a month.</>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 460 }}
          role="img"
          aria-label={`New products made each month, ${cur.year}${prev ? ` against ${prev.year}` : ''}`}
        >
          {[0, Math.round(maxY / 2), maxY].map((v) => (
            <g key={`g${v}`}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
            </g>
          ))}
          {MONTHS.map((m, i) => (
            <text key={m} x={centre(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{m}</text>
          ))}

          {MONTHS.map((mon, i) => {
            const prevN = prev ? prev.months[i].created : 0;
            const curN = cur.months[i].created;
            // Months this year that haven't happened yet get NO bar (not a zero one) — a zero would claim we made nothing in a month
            // that hasn't arrived. Last year's bar still draws there, which is the useful part: what the rest of the year looked like.
            const future = i + 1 > through;
            const pairL = centre(i) - (prev ? barW + 1 : barW / 2);
            const curX = prev ? centre(i) + 1 : centre(i) - barW / 2;
            return (
              <g key={`b${mon}`}>
                {prev && prevN > 0 && (
                  <rect x={pairL} y={y(prevN)} width={barW} height={barH(prevN)} rx={2} fill={PREV_COLOR}>
                    <title>{`${mon} ${prev.year}: ${prevN} made`}</title>
                  </rect>
                )}
                {!future && curN > 0 && (
                  <rect x={curX} y={y(curN)} width={barW} height={barH(curN)} rx={2} fill={NOW_COLOR}>
                    <title>{`${mon} ${cur.year}: ${curN} made`}</title>
                  </rect>
                )}
                {/* The count sits over this year's bar: these are small numbers, so printing them beats making the reader hover. */}
                {!future && curN > 0 && (
                  <text x={curX + barW / 2} y={y(curN) - 3} textAnchor="middle" fontSize="9" fill="#64748b">{curN}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Only ever rendered once something has actually been deleted — until then there is nothing to say and the panel stays clean. */}
      {deleted > 0 && (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
          {deleted} removed over the same period.
        </p>
      )}
    </div>
  );
}
