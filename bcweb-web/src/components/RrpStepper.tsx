'use client';
/*
=======================================================================================================================================
Component: RrpStepper — − / + beside a price box, in steps of 5% of RRP, with the % shown (owner, 2026-11-15, option A)
=======================================================================================================================================
Purpose: step a clearance price up and down without typing (owner: "I would like to step up and down on the set price easier than
         typing. I might want more than 50%"). A £60 RRP size at £30.00 reads "50%"; + makes it £33.00 · 55%. Typing still works.

STEPS SNAP to the 5% grid: a price at 48% goes to 50% on +, to 45% on −. Never below 5%; no top limit (over RRP is flagged elsewhere,
         never blocked). An empty box steps from `fallback` (the box's hint, e.g. 50% of RRP). No RRP = no buttons, just the box.

Used on the Clearance screen's price boxes (Shopify size price, eBay) and the eBay listing form (Not on eBay).
=======================================================================================================================================
*/

import type { ReactNode } from 'react';

const STEP = 0.05;

const parse = (text: string) => {
  const v = Number(text);
  return text.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
};

// The next price on the 5% grid above (dir 1) or below (dir -1) the current one, as a 2dp string.
export function stepPrice(text: string, fallback: number | null, rrp: number, dir: 1 | -1): string {
  const base = parse(text) ?? fallback ?? rrp * 0.5;
  const k = base / rrp / STEP;
  const next = Math.max(1, dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1);
  return (Math.round(rrp * next * STEP * 100) / 100).toFixed(2);
}

export default function RrpStepper({ text, onChange, rrp, fallback = null, disabled = false, children }: {
  text: string; onChange: (text: string) => void; rrp: number | null; fallback?: number | null; disabled?: boolean; children: ReactNode;
}) {
  if (!rrp || rrp <= 0) return <>{children}</>;
  const shown = parse(text) ?? (text.trim() === '' ? fallback : null);
  const btn = 'h-7 w-7 shrink-0 rounded-md border border-slate-300 bg-white text-sm font-semibold leading-none text-slate-700 hover:bg-slate-50 disabled:opacity-40';
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(stepPrice(text, fallback, rrp, -1))}
        title="Down 5% of RRP" aria-label="Down 5% of RRP">−</button>
      {children}
      <button type="button" className={btn} disabled={disabled} onClick={() => onChange(stepPrice(text, fallback, rrp, 1))}
        title="Up 5% of RRP" aria-label="Up 5% of RRP">+</button>
      <span className="w-10 text-xs tabular-nums text-slate-500" title="Of RRP">{shown !== null ? `${Math.round((shown / rrp) * 100)}%` : ''}</span>
    </span>
  );
}
