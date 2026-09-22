'use client';
/*
=======================================================================================================================================
Component: AdditionsTrend  (the PRODUCTION panel on Reports -> New)
=======================================================================================================================================
Purpose: How much new product we are making, and how the pace through this year compares with last. The list on the screen below
         answers "what did we add lately and is it selling"; this answers the different question of OUTPUT — the rate at which new
         lines get built.

Why cumulative lines and not monthly bars: the months are violently lumpy (2026 ran Feb 0, Mar 22, Jun 30, Aug 3), so bars read as
noise and nothing about pace survives them. Running totals against the same point last year turn it into the question actually being
asked — are we ahead or behind — and a flat stretch still shows a dead month plainly enough.

Counted from product_event_log, which keeps the event after the product is deleted — so a line that was built and later killed still
counts as work done (skusummary.created_at only ever shows survivors). Months before the log was installed are backfilled from the
catalogue and therefore survivors-only; the owner's call is that this does not need saying on screen.

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

  // Like-for-like: this year against last year at the SAME point, not against its full twelve months. Comparing a part-year with a
  // whole one is the easiest way to look behind when you are ahead.
  const ytd = curCum[through - 1];
  const prevAtSamePoint = prevCum ? prevCum[through - 1] : null;
  const delta = prevAtSamePoint === null ? null : ytd - prevAtSamePoint;
  const deleted = years.reduce((s, y) => s + y.months.reduce((t, m) => t + m.deleted, 0), 0);

  const W = 720, H = 200, padL = 32, padR = 14, padT = 14, padB = 26;
  const maxY = Math.max(1, curCum[through - 1], ...(prevCum || [0]));
  const x = (i: number) => padL + (i / 11) * (W - padL - padR);
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const pts = (vals: number[], upto = 12) => vals.slice(0, upto).map((v, i) => `${x(i)},${y(v)}`).join(' ');

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

      <div className="mt-3 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ minWidth: 460 }}
          role="img"
          aria-label={`New products made per month, running total, ${cur.year}${prev ? ` against ${prev.year}` : ''}`}
        >
          {[0, Math.round(maxY / 2), maxY].map((v) => (
            <g key={`g${v}`}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
              <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
            </g>
          ))}
          {MONTHS.map((m, i) => (
            <text key={m} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{m}</text>
          ))}

          {prevCum && <polyline points={pts(prevCum)} fill="none" stroke={PREV_COLOR} strokeWidth={2} />}
          <polyline points={pts(curCum, through)} fill="none" stroke={NOW_COLOR} strokeWidth={2} />
          {curCum.slice(0, through).map((v, i) => (
            <circle key={`c${i}`} cx={x(i)} cy={y(v)} r={3.5} fill={NOW_COLOR} stroke="#fff" strokeWidth={2}>
              <title>{`${MONTHS[i]} ${cur.year}: ${cur.months[i].created} made (${v} by end of ${MONTHS[i]})`}</title>
            </circle>
          ))}
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
