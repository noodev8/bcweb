'use client';
/*
=======================================================================================================================================
Component: SalesList
=======================================================================================================================================
Purpose: A reference report on the drill screen — recent RAW Shopify SALES for this style, one row per sale line with the price it sold
         at (date, size, qty, sold price). The pricing timeline above aggregates these by price; this is the granular view beneath it.
         Collapsible; LAZY-loads (GET /pricing-sales only on first open) to keep the initial drill fast. Bounded by most-recent-N rows
         (sales are dense on a hot style) — when more exist, a "showing last N" note appears. Newest first.

         On the drill this section is OPEN by default, so its length is the operator's problem: a hot style's 50 sale lines pushed the
         rest of the page off screen, and what's actually read is the latest handful. So the table renders the first PREVIEW_ROWS (10)
         and RowsToggle offers the rest on one click — no second fetch, the rows are already loaded.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getSales, SaleRow } from '@/lib/api';
import RowsToggle, { PREVIEW_ROWS } from '@/components/RowsToggle';
import { useApiQuery } from '@/lib/useApiQuery';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

// defaultOpen: start expanded and fetch on mount. Recent sales is the report the operator goes straight to (owner, 2026-07-20), so on
// the drill it opens itself; elsewhere it stays a click-to-open dropdown. Still lazy — the fetch fires when it opens, mount or click.
const NO_ROWS: SaleRow[] = [];

export default function SalesList({ groupid, defaultOpen = false }: { groupid: string; defaultOpen?: boolean }) {
  // Opening the panel IS the fetch trigger: a null key means "don't fetch yet", so the old loaded/loading guards and the
  // auto-load effect (which existed only to cover defaultOpen) are gone. defaultOpen now simply starts `open` true.
  const [open, setOpen] = useState(defaultOpen);
  const { data, error: loadError, busy: loading } = useApiQuery(
    open ? ['sales', groupid] : null,
    () => getSales(groupid),
  );
  const rows: SaleRow[] = data?.rows ?? NO_ROWS;
  const truncated = data?.truncated ?? false;
  const limit = data?.limit ?? 0;
  const error = loadError?.message ?? null;

  // "Show all" is stored as WHICH groupid it was expanded for, not a bare boolean. That makes the collapse-on-new-groupid behaviour fall
  // out of a pure comparison instead of needing an effect to reset it (react-hooks/set-state-in-effect), and it is what the old code
  // achieved by calling setShowAll(false) inside every fetch.
  const [showAllFor, setShowAllFor] = useState<string | null>(null);
  const showAll = showAllFor === groupid;
  const setShowAll = (v: boolean | ((prev: boolean) => boolean)) => setShowAllFor((typeof v === 'function' ? v(showAll) : v) ? groupid : null);


  const toggle = () => setOpen((v) => !v);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700"
      >
        <span>Recent sales <span className="font-normal text-slate-400">— individual sales &amp; the price each sold at</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No Shopify sales recorded for this style.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Date</th>
                      <th className="py-1.5 pr-4 font-medium">Size</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Sold at</th>
                      <th className="py-1.5 text-right font-medium">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(showAll ? rows : rows.slice(0, PREVIEW_ROWS)).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap py-1.5 pr-4 text-slate-600">
                          {fmtDate(r.solddate)}{r.ordertime ? <span className="text-slate-400"> {r.ordertime}</span> : null}
                        </td>
                        <td className="py-1.5 pr-4 font-mono text-slate-600">{r.size || '—'}</td>
                        <td className="py-1.5 pr-4 text-right font-semibold tabular-nums text-slate-800">{money(r.soldprice)}</td>
                        <td className={`py-1.5 text-right font-semibold tabular-nums ${r.profit === null ? 'text-slate-400' : r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RowsToggle total={rows.length} showingAll={showAll} onToggle={() => setShowAll((v) => !v)} />
              {/* The server-side cap note only matters once the whole loaded list is on screen — before that "show all N" already tells
                  the operator how many rows there are to see. */}
              {truncated && showAll && (
                <p className="mt-3 text-xs text-slate-400">The last {limit} sales only — older ones aren&apos;t loaded.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
