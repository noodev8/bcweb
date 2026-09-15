'use client';
/*
=======================================================================================================================================
Component: SizeCurve
=======================================================================================================================================
Purpose: One row per EU size: OUR remaining stock, and what AMAZON charges and holds for that same size.

         Two jobs in one table, because they are read together:
           1. The cut guardrail (CLAUDE.md Stage 2) — a sold-out core (38/39 gone) must not be misread as dead demand. Sizes with 0
              are shown, never hidden, which is the whole point.
           2. The Amazon reference (2026-09-15) — this replaced the retired "match Amazon price" autopilot. Amazon prices per SIZE
              while Shopify prices per STYLE, so the operator setting one Shopify price needs the whole spread in front of them. The
              autopilot's answer was to pin Shopify to whichever size happened to be cheapest and in stock; showing all of them lets
              the operator see that a £37.30 low next to a £41.09 high is one thin size, not "Amazon's price".

         ADVISORY: nothing here constrains the price. It is evidence for a decision, not a rule that makes it.

         Opens by default when the style has Amazon stock (that's when the table has something to say); otherwise it stays the
         rarely-opened guardrail it was and starts collapsed.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { SizeRow } from '@/lib/api';

export default function SizeCurve({ sizes }: { sizes: SizeRow[] }) {
  // Amazon data present => open on arrival; pure stock curve => collapsed, as before. Lazy initial state so it is decided once, from
  // the data the component mounted with, and a later refresh doesn't yank the panel shut under the operator.
  const [open, setOpen] = useState(() => sizes.some((s) => s.amz_price !== null || s.amz_live > 0));
  const max = sizes.reduce((m, s) => Math.max(m, s.qty), 0) || 1;
  const hasAmazon = sizes.some((s) => s.amz_price !== null || s.amz_live > 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700"
      >
        <span>
          Size curve{' '}
          <span className="font-normal text-slate-400">
            — stock by size{hasAmazon ? ', with Amazon price and stock' : ''}
          </span>
        </span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {sizes.length === 0 ? (
            <p className="text-sm text-slate-400">No size data for this style.</p>
          ) : (
            <>
              {/* Column heads only when the Amazon side is populated — on a Shopify-only style the bare bars need no explaining. */}
              {hasAmazon && (
                <div className="mb-1.5 flex items-center gap-3 border-b border-slate-100 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  <span className="w-8">Size</span>
                  <span className="flex-1">Our stock</span>
                  <span className="w-12 text-right">Qty</span>
                  <span className="w-20 text-right">Amazon</span>
                  <span className="w-14 text-right">Amz qty</span>
                </div>
              )}
              <div className="space-y-1.5">
                {sizes.map((s) => {
                  const out = s.qty === 0;                 // sold out HERE — dim it, but keep it on screen (the guardrail)
                  const amzOut = s.amz_live === 0;         // listed on Amazon but out of stock there — a different fact from no listing
                  return (
                    <div key={s.size} className="flex items-center gap-3 text-sm">
                      <span className={'w-8 font-mono ' + (out ? 'text-slate-300' : 'text-slate-500')}>{s.size}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
                        <div className="h-full rounded bg-brand-500" style={{ width: `${(s.qty / max) * 100}%` }} />
                      </div>
                      <span className={'w-12 text-right tabular-nums ' + (out ? 'text-slate-300' : 'text-slate-600')}>{s.qty}</span>
                      {hasAmazon && (
                        <>
                          {/* null price = this size isn't on Amazon FBA at all. It must read as "—", never as a £0.00 that looks
                              like a real (and alarmingly cheap) Amazon price. */}
                          <span className={'w-20 text-right tabular-nums ' + (s.amz_price === null || amzOut ? 'text-slate-300' : 'text-slate-700')}>
                            {s.amz_price !== null ? `£${s.amz_price.toFixed(2)}` : '—'}
                          </span>
                          <span className={'w-14 text-right tabular-nums ' + (amzOut ? 'text-slate-300' : 'text-slate-500')}>
                            {s.amz_live}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <p className="mt-3 text-xs text-slate-400">
            A guardrail before a cut: a sold-out core (e.g. 38/39 gone) can look like dead demand when it isn&apos;t.
            {hasAmazon && ' Amazon prices per size, so there is no single Amazon price to match — this is reference, not a rule.'}
          </p>
        </div>
      )}
    </div>
  );
}
