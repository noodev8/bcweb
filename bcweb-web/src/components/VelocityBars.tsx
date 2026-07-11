/*
=======================================================================================================================================
Component: VelocityBars  (shared "Velocity — 6 weeks" evidence block — drill-evidence-spec §4, block 2)
=======================================================================================================================================
Purpose: The velocity TREND, rendered IDENTICALLY on both drills (Shopify /pricing/style/[groupid] and Amazon /amz/sku/[code]) so the
         two screens can't drift. One bar per week over the last 6 weeks, oldest→newest left-to-right (a trend is read that way — this is
         NOT the timeline's "latest on top" table rule). A halving week-over-week is the act-now signal.

         This is the "still selling?" complement to PriceBands: units-by-price is a cumulative 60-day total, so a fat bar there can be a
         price that sold hard early then died — only the recent-weeks trend confirms it's STILL moving (spec §1). Zero-filled upstream so
         a gap week reads 0, not a hidden hole. Read-only and channel-agnostic: takes the shared VelocityWeek[] both drills now return.
=======================================================================================================================================
*/

import { VelocityWeek } from '@/lib/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Format an ISO week-start (YYYY-MM-DD) as "3 Jun" from local components (no Date parse — avoids the BST UTC day-shift).
function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export default function VelocityBars({ weeks }: { weeks: VelocityWeek[] }) {
  // Scale bars to the busiest week (min 1 so an all-zero set can't divide by zero).
  const maxWeek = Math.max(1, ...weeks.map((w) => w.units));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Velocity — 6 weeks</h3>
      <div className="flex items-end gap-1.5" style={{ height: 72 }}>
        {weeks.map((w) => (
          <div
            key={w.week_start}
            className="flex flex-1 flex-col items-center justify-end"
            title={`${w.units} sold · avg ${w.avg_price !== null ? '£' + w.avg_price.toFixed(2) : '—'}`}
          >
            <span className="mb-0.5 text-[10px] font-medium text-slate-600">{w.units}</span>
            <div className="w-full rounded-t bg-emerald-400" style={{ height: Math.round((w.units / maxWeek) * 48) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {weeks.map((w) => (
          <span key={w.week_start} className="flex-1 text-center text-[10px] text-slate-400">{fmtShort(w.week_start)}</span>
        ))}
      </div>
    </div>
  );
}
