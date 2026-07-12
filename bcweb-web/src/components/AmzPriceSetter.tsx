'use client';
/*
=======================================================================================================================================
Component: AmzPriceSetter  (the Amazon set-price control)
=======================================================================================================================================
Purpose: The SKU-grain price control on the Amazon drill. Leaner than the Shopify PriceSetter — Amazon has NO review/park concept and NO
         live push, so there are no review chips and no "just set review" action. Applying queues the change into the session upload
         basket (and writes the amz_price_log audit row); the price reaches Amazon only when the operator downloads + uploads the file.

   Current: 37.99   FBA: 96 (+0)   Net margin: 18.94 (50%)   floor 19.07   RRP 45.00
   New price:  [−£1][−50p][−30p]  [ 38.29 ]  [+30p][+50p][+£1]      <- big editable field; margin recalculates live
   Note:       [ optional — why the price is changing (saved to the price log) ]
   [ Apply price → basket ]   [ Cancel ]

Rules, enforced here for UX and AGAIN on the server (never trust the client):
  - Nudge buttons step the editable price (the engine's typical £0.30 / £0.50 / £1.00 moves); net margin updates live.
  - Disable Apply if price < floor (cost + FBA fee — breakeven). Warn (but allow) if price > RRP.
  - Note is optional; it's saved to the amz_price_log row as the rationale.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import ChannelBadge from '@/components/ChannelBadge';
import { AmzDrillHeader } from '@/lib/api';

interface AmzPriceSetterProps {
  header: AmzDrillHeader;
  applying: boolean;                                  // disables buttons while a write is in flight
  queuedPrice?: number | null;                        // if this SKU is already in the basket, its queued price (for the button label)
  onApply: (newPrice: number, note: string) => void;
  onCancel: () => void;
}

export default function AmzPriceSetter({ header, applying, queuedPrice, onApply, onCancel }: AmzPriceSetterProps) {
  const now = header.price;

  // Editable price starts at the current price (or blank if unknown). Kept as a string so the user can type freely.
  const [priceStr, setPriceStr] = useState<string>(now !== null ? now.toFixed(2) : '');
  const [note, setNote] = useState('');

  const price = useMemo(() => {
    const p = parseFloat(priceStr);
    return Number.isFinite(p) ? p : NaN;
  }, [priceStr]);

  // Live NET margin = price − cost − FBA fee (the real per-unit contribution on Amazon). null when any part is unknown.
  const margin = Number.isFinite(price) && header.cost !== null && header.fbafee !== null
    ? Math.round((price - header.cost - header.fbafee) * 100) / 100
    : null;
  const marginPct = margin !== null && price ? Math.round((margin / price) * 100) : null;

  const belowFloor = header.floor !== null && Number.isFinite(price) && price < header.floor;
  const aboveRrp = header.rrp !== null && Number.isFinite(price) && price > header.rrp;
  const priceValid = Number.isFinite(price) && price > 0;
  const changed = now === null || (Number.isFinite(price) && Math.round(price * 100) !== Math.round(now * 100));

  const applyDisabled = applying || !priceValid || belowFloor || !changed;

  function nudge(delta: number) {
    const base = Number.isFinite(price) ? price : (now ?? 0);
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setPriceStr(next.toFixed(2));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Platform banner — the Amazon and Shopify drills look near-identical, so name the channel RIGHT ON the control (not just in the
          top nav) to kill the "I thought I was changing the other platform" mix-up. Amber = Amazon throughout; Apply here only QUEUES. */}
      <div className="-mx-5 -mt-5 mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-t-xl border-b border-amber-200 bg-amber-50 px-5 py-2.5">
        <ChannelBadge channel="amazon" label="Amazon price" />
        <span className="text-xs text-amber-700/90">Apply queues a Seller Central upload — no live change</span>
      </div>

      {/* Reference line: current / FBA / net margin / floor / RRP */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-slate-500">Current: <span className="font-semibold text-slate-800">{now !== null ? `£${now.toFixed(2)}` : '—'}</span></span>
        <span className="text-slate-500">
          FBA: <span className="font-semibold text-slate-800">{header.fba_live}</span>
          {header.fba_inbound > 0 && <span className="text-slate-400"> (+{header.fba_inbound})</span>}
        </span>
        <span className="text-slate-500">
          Net margin: <span className="font-semibold text-slate-800">{margin !== null ? `£${margin.toFixed(2)}` : '—'}</span>
          {marginPct !== null && <span className="text-slate-400"> ({marginPct}%)</span>}
        </span>
        <span className="text-slate-400">floor {header.floor !== null ? header.floor.toFixed(2) : '—'}</span>
        <span className="text-slate-400">RRP {header.rrp !== null ? header.rrp.toFixed(2) : '—'}</span>
      </div>

      {/* New price row: nudge down | editable | nudge up (the engine's typical £0.30 / £0.50 / £1.00 steps) */}
      <div className="mb-1 text-sm font-medium text-slate-700">New price</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={() => nudge(-1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−£1</button>
        <button onClick={() => nudge(-0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−50p</button>
        <button onClick={() => nudge(-0.3)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−30p</button>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">£</span>
          <input
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            inputMode="decimal"
            className="w-32 rounded-md border-2 border-slate-300 py-2 pl-7 pr-2 text-center text-xl font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <button onClick={() => nudge(0.3)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+30p</button>
        <button onClick={() => nudge(0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+50p</button>
        <button onClick={() => nudge(1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+£1</button>
      </div>

      {/* Bound feedback */}
      <div className="mb-4 min-h-[1.25rem] text-xs">
        {belowFloor && <span className="text-red-600">Below floor (£{header.floor!.toFixed(2)} = cost + FBA fee) — can&apos;t apply.</span>}
        {!belowFloor && aboveRrp && (
          <span className="text-amber-600">Above RRP (£{header.rrp!.toFixed(2)}) — allowed, but check.</span>
        )}
      </div>

      {/* Note (optional) — saved to the amz_price_log row. Only meaningful on a real price change. */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Note <span className="font-normal text-slate-400">(optional — saved to the price log)</span>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!changed}
        maxLength={500}
        placeholder={changed ? 'Why the price is changing' : 'Change the price to add a note'}
        className="mb-5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => onApply(Math.round(price * 100) / 100, note.trim())}
          disabled={applyDisabled}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : queuedPrice != null ? 'Update Amazon price → basket' : 'Apply to Amazon → basket'}
        </button>
        <button
          onClick={onCancel}
          disabled={applying}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        {queuedPrice != null && <span className="text-xs text-emerald-700">✓ queued → £{queuedPrice.toFixed(2)}</span>}
      </div>
    </div>
  );
}
