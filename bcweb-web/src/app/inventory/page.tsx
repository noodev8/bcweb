'use client';
/*
=======================================================================================================================================
Page: /inventory  (Inventory Management — slice 1: the style list + the drill-down filter)
=======================================================================================================================================
Purpose: "Have we got this?" The whole style list, narrowed by successive text terms. Mirrors the legacy PowerBuilder Inventory screen
         the owner uses daily (docs/inventory-powerbuilder.png), which is the fastest way they have of finding stock with a customer
         standing in the shop.

The filter is deliberately dumb (docs/inventory-spec.md §2a — a chip-builder was explicitly rejected as too complex):
  - Two boxes: Contains / Does not contain. Either or both may be filled. Enter or FIND applies them.
  - Each FIND narrows what is ALREADY on screen, then CLEARS the boxes ready for the next term. That successive narrowing is the
    whole interaction: "Arizona" -> not "EVA" -> "black".
  - The breadcrumb is display-only. Steps are not individually removable — if you got it wrong, Reset and start again (owner).

We hold the full list in state and re-derive the filtered view from an ordered list of steps, rather than destructively narrowing a
working array. Same result on screen, but Reset is free and there is only ever one source of truth.

Both boxes force UPPERCASE (owner), matching the Add/Modify and pricing search fields — groupids and codes are uppercase, so a
consistent look. This is display only: matching lowercases both sides, so a lowercase title still matches.

SEGMENT AND ORDER ARE "HIDDEN TRUTHS" (owner): both are fetched and segment IS matched by the filter, but NEITHER is shown as a
column. Typing "EVA-SEG" still narrows the list to that segment even though no segment text appears on screen. Do not delete
`segment` from the row type or the haystack because it looks unused in the table — that would silently break segment search.

Matching is case-insensitive substring over title + groupid + segment concatenated. Concatenating matters: the one style whose title
says "EVA" but whose segment is ARIZONA-GENERAL (1015471-ARIZONA) is only excluded by a "does not contain EVA" step because the TITLE
is in the haystack. skusummary.colour is deliberately NOT in it — it is an overloaded tag (Mocha filed under Brown), so matching
"black" against it would mislead; shopifytitle carries the colour anyway.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getInvStyles, getInvStock, InvStyleRow, InvStockData } from '@/lib/api';
import InvStockPanel from '@/components/InvStockPanel';
import { useAuth } from '@/contexts/AuthContext';

// One applied narrowing step. `has` keeps matching rows; `not` drops them.
interface FilterStep {
  op: 'has' | 'not';
  term: string;
}

// The text a filter step is matched against. Built once per row and cached, so a four-step filter over ~280 rows does no repeated
// string building. Lowercased here so each step is a plain indexOf.
function haystack(r: InvStyleRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''}`.toLowerCase();
}

export default function InventoryPage() {
  const { logout } = useAuth();

  const [rows, setRows] = useState<InvStyleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The two input boxes, and the ordered list of steps applied so far.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<FilterStep[]>([]);

  // The selected style's stock position. `selected` is tracked separately from `stock` so the clicked row can highlight immediately
  // while the fetch is still in flight — the list must never feel unresponsive.
  const [selected, setSelected] = useState<string | null>(null);
  const [stock, setStock] = useState<InvStockData | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  // The groupid of the most recent stock request — used to discard out-of-order responses (see onSelect).
  const reqRef = useRef<string | null>(null);

  // Fetch the whole list once. Everything after this is local.
  useEffect(() => {
    (async () => {
      const res = await getInvStyles();
      if (res.success && res.data) {
        setRows(res.data.rows);
      } else {
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load inventory');
      }
      setLoading(false);
    })();
  }, [logout]);

  // Pre-compute each row's haystack once per fetch, not once per filter pass.
  const indexed = useMemo(() => rows.map((r) => ({ row: r, hay: haystack(r) })), [rows]);

  // Apply every step in order. Steps are ANDed, which is what successive narrowing means.
  const filtered = useMemo(() => {
    let out = indexed;
    for (const s of steps) {
      const t = s.term.toLowerCase();
      out = s.op === 'has'
        ? out.filter((x) => x.hay.includes(t))
        : out.filter((x) => !x.hay.includes(t));
    }
    return out.map((x) => x.row);
  }, [indexed, steps]);

  // FIND: turn whatever is in the boxes into steps, then clear the boxes. Blank boxes are ignored, so pressing Enter in an empty
  // form is a no-op rather than an error.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    if (next.length === 0) return;
    setSteps((prev) => [...prev, ...next]);
    setContains('');
    setNotContains('');
  }

  // Reset clears the whole screen back to its opening state — filter steps, boxes AND the selected style's grid. Leaving a stock
  // panel on screen for a style that is no longer in the (now unfiltered) result set is confusing: it looks like a current selection
  // when the operator has just started a fresh hunt (owner).
  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setSelected(null);
    setStock(null);
    setStockError(null);
    setStockLoading(false);
    reqRef.current = null;
  }

  // Load one style's stock position. Clicking the already-selected row collapses the panel, so the operator can get the full list
  // height back without having to pick something else.
  async function onSelect(groupid: string) {
    if (selected === groupid) {
      setSelected(null);
      setStock(null);
      return;
    }
    setSelected(groupid);
    setStock(null);
    setStockError(null);
    setStockLoading(true);
    reqRef.current = groupid;

    const res = await getInvStock(groupid);

    // Drop a stale response: if the operator clicked another style while this was in flight, the newer request owns the panel.
    // Tracked in a ref rather than by reading `selected` (which would be captured stale in this closure) or inside a state updater
    // (which must stay pure — StrictMode double-invokes it).
    if (reqRef.current !== groupid) return;

    if (res.success && res.data) {
      setStock(res.data);
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;
    } else {
      setStockError(res.error || 'Failed to load stock position');
    }
    setStockLoading(false);
  }

  return (
    <AppShell title="Inventory" subtitle="Find stock by title, groupid or segment">
      {/* ---- Filter ------------------------------------------------------------------------------------------------------ */}
      <form onSubmit={onFind} className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                value={contains}
                onChange={(e) => setContains(e.target.value.toUpperCase())}
                autoFocus
                placeholder="e.g. ARIZONA"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => setNotContains(e.target.value.toUpperCase())}
              placeholder="e.g. EVA"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button type="submit" className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Find
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={steps.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Reset
          </button>
        </div>

        {/* Breadcrumb of applied steps + the row count. The count lives HERE, at the top, not just under the table: the operator
            uses it to decide whether to narrow again, and scrolling to the bottom of a 280-row list to find that out is the exact
            friction we are removing (owner). */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            Rows: <span className="font-semibold text-slate-800">{filtered.length}</span>
            {steps.length > 0 && <span className="text-slate-400"> of {rows.length}</span>}
          </span>
          {steps.length > 0 && (
            <>
              <span className="text-slate-300">|</span>
              {steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-300">›</span>}
                <span
                  className={
                    s.op === 'has'
                      ? 'rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700'
                      : 'rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500 line-through decoration-slate-400'
                  }
                >
                  {s.op === 'not' && <span className="mr-0.5 no-underline">¬</span>}
                  {s.term}
                </span>
                </span>
              ))}
            </>
          )}
        </div>
      </form>

      {/* ---- Stock position (selected style) ------------------------------------------------------------------------------
          Sits ABOVE the list, following the legacy PowerBuilder layout. That is inverted versus our other modules (list-then-drill)
          but it is right here: the operator picks a style once and then studies the grid, so the grid must not slide down the page
          as the result list grows. */}
      {stockLoading && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
          Loading stock position…
        </div>
      )}
      {stockError && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{stockError}</div>}
      {/* key={groupid} so picking a different style remounts the panel and clears its chosen size — otherwise the previous style's
          size selection would carry over and point at a size the new style may not even have. */}
      {stock && !stockLoading && <InvStockPanel key={stock.groupid} data={stock} />}

      {/* ---- List -------------------------------------------------------------------------------------------------------- */}
      {loading && <p className="text-sm text-slate-400">Loading stock…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2 text-right font-medium">#</th>
                <th className="px-4 py-2 font-medium">Groupid</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-right font-medium">Local</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r, i) => (
                <tr
                  key={r.groupid}
                  onClick={() => onSelect(r.groupid)}
                  className={`cursor-pointer ${selected === r.groupid ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-3 py-2 text-right text-xs text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
                  <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
                  {/* Zero is shown greyed rather than hidden: "we have none" is a real, useful answer here. */}
                  <td className={`px-4 py-2 text-right tabular-nums ${r.total ? 'text-slate-700' : 'text-slate-300'}`}>{r.total}</td>
                  <td className={`px-4 py-2 text-right font-medium tabular-nums ${r.local ? 'text-slate-900' : 'text-slate-300'}`}>{r.local}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                    No styles match. <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
