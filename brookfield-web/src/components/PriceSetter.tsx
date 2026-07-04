'use client';
/*
=======================================================================================================================================
Component: PriceSetter  (the set-price control — CLAUDE.md)
=======================================================================================================================================
Purpose: The reduced-typing price control. Layout mirrors the owner's desktop app:

   Current: 36.95   Margin: 16.12 (44%)   RRP 50.00  min 35.99  max 45.00
   New price:  [-£1][-50p]  [ 37.95 ]  [+50p][+£1][+£2]        <- big editable field; margin recalculates live
   Review in:  (3)(5)(7*)(10)(14)(30)(90) days                 <- single-select chips; * = suggested for this move type
   [ Apply price ]   [ No change — just set review ]   [ Cancel ]

Rules (CLAUDE.md), enforced here for UX and AGAIN on the server (never trust the client):
  - Nudge buttons step the editable price; margin updates live.
  - Disable Apply if price < cost or price < min. Warn (but allow) if price > max or > rrp.
  - A price change REQUIRES a review period (chip). "No change — just set review" needs only a chip.
  - Suggested review per move type: raise ~7, cut ~14, hold ~30 (suggest; user can change).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { DrillHeader } from '@/lib/api';

const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

interface PriceSetterProps {
  header: DrillHeader;
  applying: boolean;                                            // disables buttons while a write is in flight
  onApply: (newPrice: number, reviewDays: number) => void;
  onPark: (reviewDays: number) => void;
  onCancel: () => void;
}

// Suggested review period by move type (CLAUDE.md): raise-probe ~7, cut-to-clear ~14, hold/healthy ~30.
function suggestReview(price: number, now: number | null): number {
  if (now === null) return 30;
  if (price > now) return 7;   // raise
  if (price < now) return 14;  // cut
  return 30;                    // hold
}

export default function PriceSetter({ header, applying, onApply, onPark, onCancel }: PriceSetterProps) {
  const now = header.now;
  // Editable price starts at the current price (or blank if unknown). Kept as a string so the user can type freely.
  const [priceStr, setPriceStr] = useState<string>(now !== null ? now.toFixed(2) : '');
  const [reviewDays, setReviewDays] = useState<number>(suggestReview(now ?? 0, now));
  const [userPickedReview, setUserPickedReview] = useState(false);

  const price = useMemo(() => {
    const p = parseFloat(priceStr);
    return Number.isFinite(p) ? p : NaN;
  }, [priceStr]);

  const suggested = Number.isFinite(price) ? suggestReview(price, now) : 30;

  // If the user hasn't manually chosen a chip, keep the selection tracking the suggested period as they change the price.
  const effectiveReview = userPickedReview ? reviewDays : suggested;

  // Live margin (CLAUDE.md). null when we can't compute either side.
  const margin = Number.isFinite(price) && header.cost !== null ? Math.round((price - header.cost) * 100) / 100 : null;
  const marginPct = margin !== null && price ? Math.round((margin / price) * 100) : null;

  // Bounds.
  const belowCost = header.cost !== null && Number.isFinite(price) && price < header.cost;
  const belowMin = header.minp !== null && Number.isFinite(price) && price < header.minp;
  const aboveMax = header.maxp !== null && Number.isFinite(price) && price > header.maxp;
  const aboveRrp = header.rrp !== null && Number.isFinite(price) && price > header.rrp;
  const priceValid = Number.isFinite(price) && price > 0;
  const changed = now === null || (Number.isFinite(price) && Math.round(price * 100) !== Math.round(now * 100));

  const applyDisabled = applying || !priceValid || belowCost || belowMin || !changed;

  function nudge(delta: number) {
    const base = Number.isFinite(price) ? price : (now ?? 0);
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setPriceStr(next.toFixed(2));
  }

  function pickReview(days: number) {
    setReviewDays(days);
    setUserPickedReview(true);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Reference line: current / margin / bounds */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-500">Current: <span className="font-semibold text-slate-800">{now !== null ? `£${now.toFixed(2)}` : '—'}</span></span>
        <span className="text-slate-500">
          Margin: <span className="font-semibold text-slate-800">{margin !== null ? `£${margin.toFixed(2)}` : '—'}</span>
          {marginPct !== null && <span className="text-slate-400"> ({marginPct}%)</span>}
        </span>
        <span className="text-slate-400">RRP {header.rrp !== null ? header.rrp.toFixed(2) : '—'}</span>
        <span className="text-slate-400">min {header.minp !== null ? header.minp.toFixed(2) : '—'}</span>
        <span className="text-slate-400">max {header.maxp !== null ? header.maxp.toFixed(2) : '—'}</span>
      </div>

      {/* New price row: nudge down | editable | nudge up */}
      <div className="mb-1 text-sm font-medium text-slate-700">New price</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={() => nudge(-1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−£1</button>
        <button onClick={() => nudge(-0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−50p</button>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">£</span>
          <input
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            inputMode="decimal"
            className="w-32 rounded-md border-2 border-slate-300 py-2 pl-7 pr-2 text-center text-xl font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <button onClick={() => nudge(0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+50p</button>
        <button onClick={() => nudge(1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+£1</button>
        <button onClick={() => nudge(2)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+£2</button>
      </div>

      {/* Bound feedback */}
      <div className="mb-4 min-h-[1.25rem] text-xs">
        {belowCost && <span className="text-red-600">Below cost (£{header.cost!.toFixed(2)}) — can&apos;t apply.</span>}
        {!belowCost && belowMin && <span className="text-red-600">Below minimum (£{header.minp!.toFixed(2)}) — can&apos;t apply.</span>}
        {!belowCost && !belowMin && (aboveMax || aboveRrp) && (
          <span className="text-amber-600">
            Above {aboveMax ? `max (£${header.maxp!.toFixed(2)})` : ''}{aboveMax && aboveRrp ? ' and ' : ''}{aboveRrp ? `RRP (£${header.rrp!.toFixed(2)})` : ''} — allowed, but check.
          </span>
        )}
      </div>

      {/* Review chips */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Review in <span className="font-normal text-slate-400">(required to apply a price change)</span>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {REVIEW_CHIPS.map((d) => {
          const isSel = effectiveReview === d;
          const isSuggested = suggested === d;
          return (
            <button
              key={d}
              onClick={() => pickReview(d)}
              className={
                'relative rounded-full border px-3.5 py-1.5 text-sm ' +
                (isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
              }
              title={isSuggested ? 'Suggested for this move' : undefined}
            >
              {d}{isSuggested ? '*' : ''}
            </button>
          );
        })}
        <span className="text-sm text-slate-400">days</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onApply(Math.round(price * 100) / 100, effectiveReview)}
          disabled={applyDisabled}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply price'}
        </button>
        <button
          onClick={() => onPark(effectiveReview)}
          disabled={applying}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          No change — just set review
        </button>
        <button
          onClick={onCancel}
          disabled={applying}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
