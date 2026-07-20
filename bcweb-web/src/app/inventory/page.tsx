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

SIZE FILTER (owner, 2026-07-20): "the customer is a 41" — narrow to styles that have that size in LOCAL stock, and show that size's
count in the Local column. A single value kept apart from the text steps (it is the criterion that gets swapped mid-call, so it is
independently clearable), ANDed on after them. localSizes on each row carries {size: localQty}; matching is numeric so "5" finds a
zero-padded "05". Client-side over the in-memory snapshot, like every other filter here — no round-trip.

CUT (owner, 2026-07-20): a per-row manual hide, for the stragglers a text step can't drop without over-matching. It is VIEW-ONLY —
nothing is written, the DB is untouched — so a cut style reappears on Restore (un-hide, keeps the hunt) or Reset (clears everything
and re-reads the DB). Held as a Set of groupids in `cut`, applied AFTER the text filter (`visible = filtered − cut`), so a cut sticks
as you keep narrowing.

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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
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

// Normalise a size token for matching, so a typed "5" finds a stored "05" and "41" finds "41". Numeric where possible (drops the
// leading zero and any stray decimals via parseFloat); otherwise a trimmed lowercase string. localSizes keys come from the code
// suffix as stored, which can be zero-padded — this is what reconciles that with what the operator types.
function normSize(s: string): string {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? String(n) : s.trim().toLowerCase();
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

  // SIZE filter (owner: "the lady on the phone was a 41"). A SINGLE value, not a step — kept separate from the text steps so it can be
  // changed or cleared on its own (swap 41 -> 40 as the customer asks) without re-typing the text hunt. Filters to styles that have
  // that size in LOCAL stock, and once active the Local column shows the count FOR THAT SIZE. `sizeInput` is the box; `sizeFilter` is
  // the applied value (null = off).
  const [sizeInput, setSizeInput] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const sizeTarget = useMemo(() => (sizeFilter ? normSize(sizeFilter) : null), [sizeFilter]);

  // CUT: groupids the operator has hidden by hand. The text filter cannot always remove a straggler without also dropping something
  // wanted (a "does not contain" that would over-match), so Cut is the manual trim — hide THIS one row to quieten the list while
  // hunting with a customer on the phone (owner). Purely a view state: nothing is written, the DB is untouched, and Restore or Reset
  // brings them all back. Kept as a Set of groupids so a cut survives further narrowing (the same style stays hidden as you type).
  const [cut, setCut] = useState<Set<string>>(new Set());

  // The selected style's stock position. `selected` is tracked separately from `stock` so the clicked row can highlight immediately
  // while the fetch is still in flight — the list must never feel unresponsive.
  const [selected, setSelected] = useState<string | null>(null);
  const [stock, setStock] = useState<InvStockData | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  // The groupid of the most recent stock request — used to discard out-of-order responses (see onSelect).
  const reqRef = useRef<string | null>(null);
  // Reset hands focus straight back to Contains so the next hunt starts by typing, with no reach for the mouse.
  const containsRef = useRef<HTMLInputElement>(null);

  // Fetch the whole list. Called on mount and again on Reset — Reset is the natural "start a fresh hunt" moment, so it doubles as the
  // refresh-from-DB button (mirrors what the operator does in PowerBuilder). Between refreshes the list is a snapshot: every FIND
  // filters that array in the browser with no round-trip, which is what keeps the drill-down instant.
  const loadStyles = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getInvStyles();
    if (res.success && res.data) {
      setRows(res.data.rows);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load inventory');
    }
    setLoading(false);
  }, [logout]);

  useEffect(() => { loadStyles(); }, [loadStyles]);

  // Pre-compute each row's haystack once per fetch, not once per filter pass.
  const indexed = useMemo(() => rows.map((r) => ({ row: r, hay: haystack(r) })), [rows]);

  // Nothing is listed until the operator has searched at least once — a text step OR a size filter counts. The full set is already in
  // memory and IS what gets filtered; we simply do not render 280 rows nobody asked for (owner). Reset returns to this blank state.
  const searched = steps.length > 0 || sizeFilter !== null;

  // Local stock this style holds in the filtered size (0 if none / no size filter). Sums across matching keys defensively, though a
  // style normally has just one key per size.
  const sizeQtyOf = useCallback((r: InvStyleRow): number => {
    if (sizeTarget === null) return 0;
    let q = 0;
    for (const [k, v] of Object.entries(r.localSizes)) {
      if (normSize(k) === sizeTarget) q += v;
    }
    return q;
  }, [sizeTarget]);

  // Apply every text step in order (ANDed = successive narrowing), then the size filter last: keep only styles with that size on the
  // shelf.
  const filtered = useMemo(() => {
    let out = indexed;
    for (const s of steps) {
      const t = s.term.toLowerCase();
      out = s.op === 'has'
        ? out.filter((x) => x.hay.includes(t))
        : out.filter((x) => !x.hay.includes(t));
    }
    if (sizeTarget !== null) out = out.filter((x) => sizeQtyOf(x.row) > 0);
    return out.map((x) => x.row);
  }, [indexed, steps, sizeTarget, sizeQtyOf]);

  // What actually shows = the text-filtered rows minus the hand-cut ones. `filtered` stays the "how many match the text" figure;
  // `visible` is what the operator sees, and the gap between them is the cut count.
  const visible = useMemo(() => filtered.filter((r) => !cut.has(r.groupid)), [filtered, cut]);
  const cutInView = filtered.length - visible.length;   // cuts among the CURRENT matches (a cut style outside the filter isn't counted)

  // Drop the open stock panel as soon as its style is no longer in the filtered list. Without this, searching ARIZONA, opening a
  // style, then searching IVES leaves the Arizona grid sitting above a list of Ives — the panel silently describes a product that is
  // no longer on screen, which is worse than showing nothing.
  //
  // Done as an effect on `filtered` rather than inside onFind, so every path that can narrow the list is covered by one rule.
  // A style that SURVIVES the new filter keeps its panel open, which is what you want when narrowing towards it.
  // Based on `visible`, not `filtered`, so cutting the currently-open style also closes its panel — a grid describing a row you just
  // removed from the list is the same "panel outlives its row" confusion this guards against.
  useEffect(() => {
    if (selected && !visible.some((r) => r.groupid === selected)) {
      setSelected(null);
      setStock(null);
      setStockError(null);
      setStockLoading(false);
      reqRef.current = null;
    }
  }, [visible, selected]);

  // FIND: turn whatever is in the boxes into steps, then clear the boxes. Blank boxes are ignored, so pressing Enter in an empty
  // form is a no-op rather than an error.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    if (contains.trim()) next.push({ op: 'has', term: contains.trim() });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    const size = sizeInput.trim();
    // Nothing typed anywhere — a bare Enter is a no-op, not an error.
    if (next.length === 0 && !size) return;
    if (next.length > 0) setSteps((prev) => [...prev, ...next]);
    if (size) setSizeFilter(size);
    setContains('');
    setNotContains('');
    setSizeInput('');
    // Contains is home. After every Find — including one driven only from the "does not contain" or size box — focus returns here, so
    // the next term is always typed from the same place and the operator never hunts for the cursor (owner).
    containsRef.current?.focus();
  }

  // Reset clears the whole screen back to its opening state — filter steps, boxes AND the selected style's grid. Leaving a stock
  // panel on screen for a style that is no longer in the (now unfiltered) result set is confusing: it looks like a current selection
  // when the operator has just started a fresh hunt (owner).
  // Cut this one row from the view. stopPropagation because the whole row is a click target (onSelect) — a Cut must not also open the
  // style it is removing.
  function onCut(e: React.MouseEvent, groupid: string) {
    e.stopPropagation();
    setCut((prev) => {
      const next = new Set(prev);
      next.add(groupid);
      return next;
    });
  }

  // Restore all cuts WITHOUT touching the filter or re-reading the DB — the light "undo" for a mis-cut, so a fat-fingered Cut doesn't
  // force a full Reset and a re-typed hunt. Reset still clears cuts too (below), which is the "start fresh" path.
  function restoreCuts() {
    setCut(new Set());
  }

  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setSizeInput('');
    setSizeFilter(null);
    setCut(new Set());
    setSelected(null);
    setStock(null);
    setStockError(null);
    setStockLoading(false);
    reqRef.current = null;
    // Reset also RE-READS the list from the DB. The in-browser list is a snapshot taken at load, so stock figures drift as the day
    // goes on; refreshing at the moment the operator starts a fresh hunt is exactly when a stale number would bite (owner — it is
    // what they do in PowerBuilder). No separate Refresh button to remember.
    loadStyles();
    containsRef.current?.focus();
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
                ref={containsRef}
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
          {/* Size — narrow, its own box. Filters to styles with that size in LOCAL stock. Kept apart from the text boxes because it is
              a different kind of filter (structured, local-only) and the single most-swapped one on a call. */}
          <div className="w-24">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Size</label>
            <input
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 41"
              title="Show only styles with this size in local stock"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button type="submit" className="rounded-md bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Find
          </button>
          {/* Reset is also the refresh: it clears the hunt AND re-reads from the DB, so it stays enabled even with no filter applied. */}
          <button
            type="button"
            onClick={onReset}
            title="Clear the search and re-read stock from the database"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>

        {/* Breadcrumb of applied steps + the row count. The count lives HERE, at the top, not just under the table: the operator
            uses it to decide whether to narrow again, and scrolling to the bottom of a 280-row list to find that out is the exact
            friction we are removing (owner). */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            {searched ? (
              <>Rows: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {rows.length}</span></>
            ) : (
              <span className="text-slate-400">{rows.length} styles ready to search</span>
            )}
          </span>
          {/* Cut count + one-click restore. Only while some are cut, so it is invisible in the common case. Restore keeps the hunt;
              it just un-hides — Reset is the heavier "start over" that also refreshes from the DB. */}
          {cutInView > 0 && (
            <>
              <span className="text-slate-300">|</span>
              <span className="whitespace-nowrap text-slate-400">
                {cutInView} cut
                <button type="button" onClick={restoreCuts} className="ml-1.5 font-medium text-brand-600 hover:underline">
                  restore
                </button>
              </span>
            </>
          )}
          {/* Size chip — distinct from the text steps (indigo, ruler-ish) and independently removable, since size is the thing that
              gets swapped mid-call. Clearing it leaves the text hunt intact. */}
          {sizeFilter && (
            <>
              <span className="text-slate-300">|</span>
              <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                Size {sizeFilter} · local
                <button
                  type="button"
                  onClick={() => setSizeFilter(null)}
                  title="Clear size filter"
                  className="ml-0.5 rounded text-indigo-400 hover:text-indigo-700"
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            </>
          )}
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

      {/* ---- List -------------------------------------------------------------------------------------------------------- */}
      {loading && <p className="text-sm text-slate-400">Loading stock…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && !searched && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 shadow-sm">
          Type what you are looking for and press Find.
        </div>
      )}

      {!loading && !error && searched && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-3 py-2 text-right font-medium">#</th>
                <th className="px-4 py-2 font-medium">Groupid</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                {/* When a size filter is on, Local answers the actual question — "how many 41s on the shelf" — so the header names the
                    size and the cell shows that size's count, not the style's whole local total. */}
                <th className="px-4 py-2 text-right font-medium">{sizeFilter ? `Local · ${sizeFilter}` : 'Local'}</th>
                {/* Trailing Cut column — no header text, it is an action not data. */}
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r, i) => (
                <tr
                  key={r.groupid}
                  onClick={() => onSelect(r.groupid)}
                  className={`group cursor-pointer ${selected === r.groupid ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-3 py-2 text-right text-xs text-slate-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
                  <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
                  {/* Zero is shown greyed rather than hidden: "we have none" is a real, useful answer here. */}
                  <td className={`px-4 py-2 text-right tabular-nums ${r.total ? 'text-slate-700' : 'text-slate-300'}`}>{r.total}</td>
                  {/* Size-specific local count when filtering by size, else the style's whole local. Every row shown under a size
                      filter has qty > 0 by construction, so this is never a greyed zero there. */}
                  {(() => {
                    const localVal = sizeFilter ? sizeQtyOf(r) : r.local;
                    return <td className={`px-4 py-2 text-right font-medium tabular-nums ${localVal ? 'text-slate-900' : 'text-slate-300'}`}>{localVal}</td>;
                  })()}
                  {/* Cut this row. Muted until the row is hovered so it does not clutter the list, then reddens on its own hover. */}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => onCut(e, r.groupid)}
                      title="Cut from list (Restore or Reset brings it back)"
                      className="rounded p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && cutInView > 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                    All {cutInView} matching {cutInView === 1 ? 'style is' : 'styles are'} cut. <button type="button" onClick={restoreCuts} className="text-brand-600 underline">Restore</button> to bring {cutInView === 1 ? 'it' : 'them'} back.
                  </td>
                </tr>
              )}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                    No styles match. <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ---- Stock position (selected style) ------------------------------------------------------------------------------
          Sits BELOW the list, directly under the row that was clicked. It used to sit above (copying the PowerBuilder layout, on the
          reasoning that the grid should not slide down the page as the list grows) but that reasoning died once the list started
          blank and typically shows a handful of filtered rows. Clicking a row and having its detail appear ABOVE, out of view, read
          as backwards — owner hit exactly that confusion. Detail belongs next to the thing you clicked. */}
      {stockLoading && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
          Loading stock position…
        </div>
      )}
      {stockError && <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{stockError}</div>}
      {/* key={groupid} so picking a different style remounts the panel and clears its chosen size — otherwise the previous style's
          size selection would carry over and point at a size the new style may not even have. */}
      {stock && !stockLoading && (
        <div className="mt-4">
          <InvStockPanel key={stock.groupid} data={stock} />
        </div>
      )}
    </AppShell>
  );
}
