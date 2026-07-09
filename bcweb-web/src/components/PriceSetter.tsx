'use client';
/*
=======================================================================================================================================
Component: PriceSetter  (the set-price control — CLAUDE.md)
=======================================================================================================================================
Purpose: The reduced-typing price control. Layout mirrors the owner's desktop app:

   Current: 36.95   Stock: 8   Core 3/3 [38][39][40]   Margin: 16.12 (44%)   cost 20.83   RRP 50.00   <- Core = colour-graded gauge
   New price:  [-£1][-50p]  [ 37.95 ]  [+50p][+£1][+£2]        <- big editable field; margin recalculates live
   Note:       [ optional — why the price is changing (saved to the price log) ]
   Review in:  (None)(3)(5)(7)(10)(14)(30)(90) days            <- single-select; None (default) = no review. No auto-suggested pick.
   [ Apply price ]   [ No change — just set review ]   [ Cancel ]

Rules, enforced here for UX and AGAIN on the server (never trust the client):
  - Nudge buttons step the editable price; margin updates live.
  - Disable Apply if price < cost. Warn (but allow) if price > rrp. (min/max shopify-price bounds removed per owner.)
  - Review is OPTIONAL (None by default): a day chip parks the style out of triage until today+N; None leaves the review date untouched.
  - "No change — just set review" (park) needs a real period, so it's disabled while None is selected.
  - Note is optional and only enabled on a real price change; it's saved to the price_change_log row (was hardcoded blank before).
  - A price change REQUIRES a review period (chip). "No change — just set review" needs only a chip.
  - Suggested review per move type: raise ~7, cut ~14, hold ~30 (suggest; user can change).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { DrillHeader, SizeRow } from '@/lib/api';

const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Core Birkenstock sizes — our at-a-glance "is the run intact?" guardrail. Full core = it'll sell through, so a raise is safe; a
// gappy core is the classic "looks dead but it's just sold-out cores" trap before a cut (CLAUDE.md size-curve principle).
const CORE_SIZES = ['38', '39', '40'];

interface PriceSetterProps {
  header: DrillHeader;
  sizes: SizeRow[];                                             // remaining stock by size (from the drill) — feeds the core-size gauge
  applying: boolean;                                            // disables buttons while a write is in flight
  onApply: (newPrice: number, reviewDays: number | null, note: string) => void;
  onPark: (reviewDays: number) => void;
  onCancel: () => void;
}

export default function PriceSetter({ header, sizes, applying, onApply, onPark, onCancel }: PriceSetterProps) {
  const now = header.now;

  // Core-size gauge: of 38/39/40, how many are offered and how many still have stock. `offered` lets us hide the gauge for styles
  // that don't come in the core run (kids/odd ranges) rather than show a misleading all-red 0/3. Colour grades the fullness.
  const core = CORE_SIZES.map((s) => {
    const row = sizes.find((x) => x.size === s);
    return { size: s, offered: !!row, inStock: !!row && row.qty > 0 };
  });
  const coreOffered = core.some((c) => c.offered);
  const coreCount = core.filter((c) => c.inStock).length;
  const coreTone =
    coreCount >= 3 ? 'bg-green-100 text-green-700'
      : coreCount === 2 ? 'bg-lime-100 text-lime-700'
        : coreCount === 1 ? 'bg-amber-100 text-amber-700'
          : 'bg-red-100 text-red-700';
  // Editable price starts at the current price (or blank if unknown). Kept as a string so the user can type freely.
  const [priceStr, setPriceStr] = useState<string>(now !== null ? now.toFixed(2) : '');
  // Review period: null = None (the default — no auto-suggested pick; the user chooses). An optional note rides the audit row.
  const [reviewDays, setReviewDays] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const price = useMemo(() => {
    const p = parseFloat(priceStr);
    return Number.isFinite(p) ? p : NaN;
  }, [priceStr]);

  // Live margin (CLAUDE.md). null when we can't compute either side.
  const margin = Number.isFinite(price) && header.cost !== null ? Math.round((price - header.cost) * 100) / 100 : null;
  const marginPct = margin !== null && price ? Math.round((margin / price) * 100) : null;

  // Bounds. (min/max removed per owner — unused; only the below-cost block and above-RRP warning remain.)
  const belowCost = header.cost !== null && Number.isFinite(price) && price < header.cost;
  const aboveRrp = header.rrp !== null && Number.isFinite(price) && price > header.rrp;
  const priceValid = Number.isFinite(price) && price > 0;
  const changed = now === null || (Number.isFinite(price) && Math.round(price * 100) !== Math.round(now * 100));

  const applyDisabled = applying || !priceValid || belowCost || !changed;

  function nudge(delta: number) {
    const base = Number.isFinite(price) ? price : (now ?? 0);
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setPriceStr(next.toFixed(2));
  }

  function pickReview(days: number) {
    setReviewDays(days);
  }
  function pickReviewNone() {
    setReviewDays(null);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Reference line: current / margin / bounds */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-500">Current: <span className="font-semibold text-slate-800">{now !== null ? `£${now.toFixed(2)}` : '—'}</span></span>
        <span className="text-slate-500">Stock: <span className="font-semibold text-slate-800">{header.stock}</span></span>
        {coreOffered && (
          <span className="inline-flex items-center gap-1.5" title="Core sizes 38/39/40 still in stock — full core sells through (safe to raise); a gappy core can look dead when it's just sold-out cores">
            <span className={'rounded px-1.5 py-0.5 text-xs font-semibold ' + coreTone}>Core {coreCount}/3</span>
            <span className="flex gap-1">
              {core.map((c) => (
                <span
                  key={c.size}
                  className={
                    'rounded px-1 py-0.5 font-mono text-[11px] ' +
                    (c.inStock ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400 line-through')
                  }
                >
                  {c.size}
                </span>
              ))}
            </span>
          </span>
        )}
        <span className="text-slate-500">
          Margin: <span className="font-semibold text-slate-800">{margin !== null ? `£${margin.toFixed(2)}` : '—'}</span>
          {marginPct !== null && <span className="text-slate-400"> ({marginPct}%)</span>}
        </span>
        <span className="text-slate-400">cost {header.cost !== null ? header.cost.toFixed(2) : '—'}</span>
        <span className="text-slate-400">RRP {header.rrp !== null ? header.rrp.toFixed(2) : '—'}</span>
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
        {!belowCost && aboveRrp && (
          <span className="text-amber-600">Above RRP (£{header.rrp!.toFixed(2)}) — allowed, but check.</span>
        )}
      </div>

      {/* Note (optional) — saved to the price_change_log row. Only meaningful on a real price change (Apply is the only path that logs). */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Note <span className="font-normal text-slate-400">(optional — saved to the price log)</span>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!changed}
        maxLength={500}
        placeholder={changed ? 'Why the price is changing' : 'Change the price to add a note'}
        className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />

      {/* Review chips — optional single-select. None (default) leaves the review date untouched; a day parks the style out of triage. */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Review in <span className="font-normal text-slate-400">(optional — hides from pricing triage until then)</span>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* Explicit None (no review) — selected by default. */}
        <button
          onClick={pickReviewNone}
          className={
            'rounded-full border px-3.5 py-1.5 text-sm ' +
            (reviewDays === null ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
          }
        >
          None
        </button>
        {REVIEW_CHIPS.map((d) => {
          const isSel = reviewDays === d;
          return (
            <button
              key={d}
              onClick={() => pickReview(d)}
              className={
                'rounded-full border px-3.5 py-1.5 text-sm ' +
                (isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
              }
            >
              {d}
            </button>
          );
        })}
        <span className="text-sm text-slate-400">days</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onApply(Math.round(price * 100) / 100, reviewDays, note.trim())}
          disabled={applyDisabled}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply price'}
        </button>
        <button
          onClick={() => reviewDays !== null && onPark(reviewDays)}
          disabled={applying || reviewDays === null}
          title={reviewDays === null ? 'Pick a review period (not None) to park without changing the price' : undefined}
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
