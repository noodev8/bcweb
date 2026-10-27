'use client';
/*
=======================================================================================================================================
Component: ReviewPicker
=======================================================================================================================================
Purpose: "Review in (None) 3 5 7 10 14 30 90 days  [Set review]  Clear review" — the pricing screens' review control (components/PriceSetter,
         BulkActionBar) for screens whose review is a to-do marker, not a price: AMZ loaded (2026-10-26) and New Additions (2026-10-27).
         Pick a period, then Set review. None is the default, so nothing is set by accident. onSet(0) = Clear review.
=======================================================================================================================================
*/

import { useState } from 'react';

// The pricing screens' review periods (components/PriceSetter REVIEW_CHIPS), so they all read the same.
const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

export default function ReviewPicker({ busy, disabled, canClear, onSet }: {
  busy: boolean; disabled: boolean; canClear: boolean; onSet: (days: number) => Promise<boolean>;
}) {
  const [days, setDays] = useState<number | null>(null);
  const chip = (on: boolean) =>
    'rounded-full border px-3 py-1 text-sm disabled:opacity-50 ' + (on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-slate-700">Review in</span>
      <button type="button" disabled={busy || disabled} onClick={() => setDays(null)} className={chip(days === null)}>None</button>
      {REVIEW_CHIPS.map((d) => (
        <button key={d} type="button" disabled={busy || disabled} onClick={() => setDays(d)} className={chip(days === d)}>{d}</button>
      ))}
      <span className="text-sm text-slate-400">days</span>
      <button
        type="button"
        disabled={busy || disabled || days === null}
        onClick={async () => { if (days !== null && await onSet(days)) setDays(null); }}
        title={days === null ? 'Pick a review period first' : undefined}
        className="ml-1 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Set review
      </button>
      {canClear && (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onSet(0)}
          title="Clear the review date — due again"
          className="rounded-md px-2 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          Clear review
        </button>
      )}
    </div>
  );
}
