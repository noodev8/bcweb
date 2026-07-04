'use client';
/*
=======================================================================================================================================
Component: SizeCurve
=======================================================================================================================================
Purpose: Remaining stock by EU size (CLAUDE.md Stage 2). Collapsible, DEFAULT HIDDEN. Size does NOT set the price — it's a guardrail
         before a CUT (so you don't misread a sold-out core, e.g. 38/39 gone, as dead demand). For a raise it barely matters, hence
         it's tucked away by default. Simple bars scaled to the biggest size's qty.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { SizeRow } from '@/lib/api';

export default function SizeCurve({ sizes }: { sizes: SizeRow[] }) {
  const [open, setOpen] = useState(false);
  const max = sizes.reduce((m, s) => Math.max(m, s.qty), 0) || 1;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700"
      >
        <span>Size curve <span className="font-normal text-slate-400">— remaining stock by size</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {sizes.length === 0 ? (
            <p className="text-sm text-slate-400">No size data for this style.</p>
          ) : (
            <div className="space-y-1.5">
              {sizes.map((s) => {
                const out = s.qty === 0; // sold out — show it, don't hide it (the whole point of the guardrail)
                return (
                  <div key={s.size} className="flex items-center gap-3 text-sm">
                    <span className={'w-8 font-mono ' + (out ? 'text-slate-300' : 'text-slate-500')}>{s.size}</span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
                      <div className="h-full rounded bg-brand-500" style={{ width: `${(s.qty / max) * 100}%` }} />
                    </div>
                    <span className={'w-12 text-right tabular-nums ' + (out ? 'text-slate-300' : 'text-slate-600')}>
                      {s.qty}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-400">
            A guardrail before a cut: a sold-out core (e.g. 38/39 gone) can look like dead demand when it isn&apos;t.
          </p>
        </div>
      )}
    </div>
  );
}
