/*
=======================================================================================================================================
Component: PriceBands  (shared "Units by price" evidence block — drill-evidence-spec §3/§4, block 3)
=======================================================================================================================================
Purpose: The resistance / "how high can I go" guardrail, rendered IDENTICALLY on both drills (Shopify /pricing/style/[groupid] and
         Amazon /amz/sku/[code]) so the two screens can't drift. One horizontal bar per distinct price sold at over the last 60 days,
         ascending price so the ceiling reads top-down: where units thin out above a price is the discovered demand ceiling.

         Each row shows price · units bar · units · net profit/unit. profit_per_unit is the reward dimension (spec point 6) — a fat bar
         at a price that also earns well is a confident "keep pushing"; a fat bar with thin per-unit profit is volume bought cheaply.
         The current price's band is highlighted (blue) so "am I already at/near the ceiling?" is a glance.

         Read-only and channel-agnostic: it takes the shared PriceBand[] shape both drill endpoints now return. Cumulative-over-60d, so
         a big bar means "sold a lot at this price at some point", NOT necessarily "still selling" — the velocity trend answers "still"
         (spec §1). Deliberately paired with that block on both screens.
=======================================================================================================================================
*/

import { PriceBand } from '@/lib/api';

function money(v: number | null): string {
  return v !== null && v !== undefined ? `£${v.toFixed(2)}` : '—';
}

export default function PriceBands({ bands, currentPrice }: { bands: PriceBand[]; currentPrice: number | null }) {
  // Bar length is scaled to the busiest band (min 1 so an all-zero set can't divide by zero).
  const maxBand = Math.max(1, ...bands.map((b) => b.units));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Units by price — 60 days</h3>
      {bands.length === 0 ? (
        <p className="text-xs text-slate-400">No sales in the last 60 days.</p>
      ) : (
        <div className="space-y-1">
          {bands.map((b, i) => {
            const isCurrent = currentPrice !== null && b.price === currentPrice;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className={'w-14 shrink-0 text-right text-xs tabular-nums ' + (isCurrent ? 'font-semibold text-slate-800' : 'text-slate-500')}>
                  {money(b.price)}
                </span>
                <div className="h-3.5 flex-1 rounded bg-slate-100">
                  <div
                    className={'h-3.5 rounded ' + (isCurrent ? 'bg-brand-500' : 'bg-slate-300')}
                    style={{ width: `${Math.round((b.units / maxBand) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-600">{b.units}</span>
                {/* Net profit per unit at this band — the reward dimension next to the volume bar (null = no profit data for the band). */}
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-400" title="Net profit per unit at this price">
                  {b.profit_per_unit !== null ? `${money(b.profit_per_unit)}/u` : '—'}
                </span>
              </div>
            );
          })}
          <p className="pt-1 text-[10px] text-slate-400">
            blue = current price · £/u = net profit per unit. Units drying up above a price = resistance.
          </p>
        </div>
      )}
    </div>
  );
}
