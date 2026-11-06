'use client';
/*
=======================================================================================================================================
Component: BulkPercentPrice  (move a list's prices by ± x%, one channel)
=======================================================================================================================================
Purpose: The bulk price control for list screens where the job is PRICE (owner, 2026-11-06: "For most tasks, it is all about PRICE …
         change prices here in bulk. Increase or decrease by a percentage"). Built for New Additions, made to be reused (Clearance next).
         One instance per channel — Shopify and Amazon are separate actions (owner).

THE RULES (owner, 2026-11-06):
  - % OFF THE CURRENT PRICE, LEFT EXACT: −10% of £72.00 = £64.80, to the penny, no .99/.95 endings.
  - A PRICE CHANGE ONLY: no review date is touched (no due-date interaction), the normal price log with the person (server-side) and an
    AUTOMATIC note — the screen passes it (e.g. "Bulk New Additions -10%").
  - PREVIEW, THEN APPLY: the first press shows every row that will change, now → new, and FLAGS (never blocks — the price writes allow
    any price and flag it too) a price under cost / break-even or over RRP. Only Apply writes.
  - CUT FROM THE PREVIEW (owner, 2026-11-06: "can we cut from the preview too? its taking too long to cut them all"): an × on a preview
    line drops that item from THIS change only — the list on screen is untouched. No undo (owner: "Can just jump out and back in" —
    Cancel and Change… again starts with every line). THE PANEL DOESN'T CHANGE WIDTH as lines go (owner: "dont shift the width after the
    first cut"): a fixed width and fixed column widths, and nothing added to the heading when a line is dropped.

DUMB ON PURPOSE: the screen decides WHICH rows (`plan`) and does the WRITES (`apply` — the shared W1 / W-A1 routes, looped one item at a
time so every Shopify push and every per-item bound runs, as BulkActionBar does). This owns only the input, the preview, progress and
the result line.
=======================================================================================================================================
*/

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/20/solid';

export type BulkFlag = 'BELOW_COST' | 'ABOVE_RRP' | null;
export interface BulkPlanItem {
  key: string;          // groupid (Shopify) or code (Amazon)
  label: string;        // what the preview names it as
  now: number;          // current price
  next: number;         // the new price, to the penny
  flag: BulkFlag;
}
export interface BulkPlan {
  items: BulkPlanItem[];
  skipped: string | null;   // a plain note of what was left out and why, e.g. "3 not on Shopify"
}

const CHANNEL = {
  shopify: { name: 'Shopify', unit: 'style', banner: 'border-emerald-200 bg-emerald-50', note: 'Apply changes the live Shopify store immediately' },
  amazon: { name: 'Amazon', unit: 'size', banner: 'border-amber-200 bg-amber-50', note: 'Apply queues a Seller Central upload — no live change' },
} as const;

const gbp = (n: number) => `£${n.toFixed(2)}`;
const FLAG_TEXT: Record<'BELOW_COST' | 'ABOVE_RRP', string> = { BELOW_COST: 'below cost', ABOVE_RRP: 'above RRP' };

// The new price for a % move off the current one, to the penny.
export const movePrice = (now: number, pct: number) => Math.round(now * (1 + pct / 100) * 100) / 100;

export default function BulkPercentPrice({ channel, plan, apply, disabled }: {
  channel: 'shopify' | 'amazon';
  plan: (pct: number) => BulkPlan;
  // Writes the items; reports progress; resolves to the result line (e.g. "Changed 12 · 1 failed").
  apply: (items: BulkPlanItem[], pct: number, onProgress: (done: number) => void) => Promise<string>;
  disabled?: boolean;
}) {
  const c = CHANNEL[channel];
  const [text, setText] = useState('');
  // The preview, and the lines dropped from it with × (keys) — Apply writes the rest.
  const [preview, setPreview] = useState<{ pct: number; plan: BulkPlan; dropped: string[] } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;
  const pct = Number(text);
  const valid = text.trim() !== '' && Number.isFinite(pct) && pct !== 0 && pct > -90 && pct <= 100;

  function openPreview() {
    setResult(null); setError(null);
    if (!valid) { setError('Type a % between −90 and +100, e.g. -10 or 5'); return; }
    setPreview({ pct, plan: plan(pct), dropped: [] });
  }

  async function run() {
    if (!preview || kept.length === 0) return;
    const items = kept;
    setProgress({ done: 0, total: items.length });
    try {
      const line = await apply(items, preview.pct, (done) => setProgress({ done, total: items.length }));
      setResult(line);
      setPreview(null);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change stopped part way — check the prices');
    } finally {
      setProgress(null);
    }
  }

  const kept = preview ? preview.plan.items.filter((i) => !preview.dropped.includes(i.key)) : [];
  const drop = (key: string) => setPreview((p) => (p ? { ...p, dropped: [...p.dropped, key] } : p));
  const below = kept.filter((i) => i.flag === 'BELOW_COST').length;
  const above = kept.filter((i) => i.flag === 'ABOVE_RRP').length;
  const n = kept.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{c.name}</span>
        <input
          type="number" inputMode="decimal" step="any" value={text} disabled={disabled || busy}
          onChange={(e) => { setText(e.target.value); setPreview(null); setResult(null); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') openPreview(); }}
          placeholder="-10"
          aria-label={`${c.name} price change in %`}
          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-sm text-slate-500">%</span>
        <button
          type="button" onClick={openPreview} disabled={disabled || busy || text.trim() === ''}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
        >
          Change…
        </button>
        {progress && <span className="text-sm tabular-nums text-slate-500">Changing {progress.done}/{progress.total}…</span>}
        {result && !progress && <span role="status" className="text-sm font-medium text-emerald-700">{result}</span>}
        {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
      </div>

      {preview && !busy && (
        <div className={'w-[32rem] max-w-full rounded-lg border p-3 text-sm ' + c.banner}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-slate-900">
              {c.name} {preview.pct > 0 ? '+' : ''}{preview.pct}% on {n} {c.unit}{n === 1 ? '' : 's'}
            </span>
            {below > 0 && <span className="font-medium text-rose-700">{below} below {channel === 'amazon' ? 'break-even' : 'cost'}</span>}
            {above > 0 && <span className="font-medium text-amber-800">{above} above RRP</span>}
            {preview.plan.skipped && <span className="text-slate-500">· left out: {preview.plan.skipped}</span>}
            <span className="text-xs text-slate-500">{c.note}</span>
          </div>
          {n === 0 ? (
            <p className="text-slate-600">{preview.dropped.length > 0 ? 'Every line is dropped — Cancel and start again.' : 'Nothing on the list to change.'}</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col />
                  <col className="w-16" />
                  <col className="w-5" />
                  <col className="w-16" />
                  <col className="w-28" />
                  <col className="w-8" />
                </colgroup>
                <tbody>
                  {kept.map((i) => (
                    <tr key={i.key} className="border-t border-slate-100 first:border-t-0">
                      <td className="truncate px-2 py-1 font-mono text-slate-800">{i.label}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">{gbp(i.now)}</td>
                      <td className="px-1 py-1 text-slate-400">→</td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums text-slate-900">{gbp(i.next)}</td>
                      <td className="px-2 py-1">
                        {i.flag && (
                          <span className={i.flag === 'BELOW_COST' ? 'text-rose-700' : 'text-amber-800'}>
                            {i.flag === 'BELOW_COST' && channel === 'amazon' ? 'below break-even' : FLAG_TEXT[i.flag]}
                          </span>
                        )}
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button type="button" onClick={() => drop(i.key)} aria-label={`Leave ${i.label} out of this change`}
                                className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button" onClick={run} disabled={n === 0}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Apply to {n} {c.unit}{n === 1 ? '' : 's'}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="px-2 py-1.5 text-sm text-slate-600 hover:text-slate-900">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
