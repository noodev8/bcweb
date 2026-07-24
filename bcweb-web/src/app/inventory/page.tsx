'use client';
/*
=======================================================================================================================================
Page: /inventory  (Inventory Management — BROWSE redesign, 2026-07-23)
=======================================================================================================================================
Purpose: "Have we got this, in my size, and where is it?" The operator filters the catalogue down, then scrolls a stack of rich cards
         — like a shop's category page — each showing the product picture, its in-stock sizes, and (on a tap) which racks a size is on.

         Why a browse and not a list-plus-detail-panel: the normal result is a dozen near-identical black Arizonas, and a browse shows
         every picture at once, which is how a human tells them apart. See InvStyleCard for the per-card behaviour.

THE FILTER IS UNCHANGED — it is the proven part of this screen and the redesign leaves it exactly as it was:
  - Two boxes: Contains / Does not contain. Either or both may be filled. Enter or Find applies them, then clears them; each Find
    narrows what is ALREADY on screen ("Arizona" -> not "EVA" -> "black"). Steps are display-only; to undo, Reset.
  - Size box: narrow to styles holding that size in LOCAL stock, and each card then LEADS with that size's count (InvStyleCard). A
    single value kept apart from the text steps, since it is the criterion swapped mid-call.
  - Cut: a per-row manual hide for stragglers a text step can't drop without over-matching. View-only; Restore or Reset brings them back.
  - Reset clears everything AND re-reads from the DB (the refresh), mirroring PowerBuilder.

TWO THINGS KEEP THE BROWSE FAST (owner, 2026-07-23 — "ensure we don't over-retrieve and slow things down"):
  1. The GATE. Card faces are cheap (they paint from the /inv-styles list already in memory), but a wall of picture cards is still a
     lot to render and scroll. Above CARD_GATE matches we DON'T paint cards — we show the count and ask for one more word. So the
     operator is nudged to filter down to a handful before the pictures load, which is the natural way to use this screen anyway.
  2. Detail is lazy. The heavy per-style /inv-stock (racks, buckets) is fetched by InvStyleCard only when a size is tapped, never on
     render. So even a full page of cards costs zero detail round-trips until someone asks a question of one.

The command bar is STICKY: it stays pinned to the top while the cards scroll under it, so the filter is always to hand mid-browse.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlassIcon, ArrowPathIcon, XMarkIcon, QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getInvStyles, InvStyleRow } from '@/lib/api';
import InvStyleCard from '@/components/InvStyleCard';
import { useAuth } from '@/contexts/AuthContext';

// One applied narrowing step. `has` keeps matching rows; `not` drops them.
interface FilterStep {
  op: 'has' | 'not';
  term: string;
}

// A worded quantity command, typed in the Contains box (owner — plain-English keywords, not "<10" symbols, so they never clash with a
// future "<"/">" meaning and read the same as the SOLD pair): "STOCK LESS 10" / "SOLD MORE 5". `metric` picks which per-row number it
// compares against (see `metricValue`); `less`/`more` are strict (< / >). One per metric is active at a time; a new command for the
// same metric replaces it. Kept apart from the text steps (like the size filter) because it is a numeric compare, not a find.
type QtyMetric = 'stock' | 'sold';
interface QtyFilter {
  metric: QtyMetric;
  op: 'less' | 'more';
  n: number;
}

// The per-row number each metric compares against:
//  - stock = local + Amazon-held: the "what have we got in hand right now" figure. Deliberately NOT row.total (that folds in the Birk
//    pre-order book — future stock, which shouldn't sway a drop decision).
//  - sold = sold30: units sold in the last 30 days (all channels), the "is it moving" figure weighed against stock to decide a drop.
function metricValue(r: InvStyleRow, metric: QtyMetric): number {
  return metric === 'stock' ? r.local + r.amazon : r.sold30;
}
function combinedStock(r: InvStyleRow): number {
  return r.local + r.amazon;
}

// SORTING (owner). A visible, click-to-reverse control rather than a worded command: sorting is a MODE you sit in and flip, not a
// one-shot action like the STOCK/SOLD filters, so it needs a standing affordance that shows the current key + direction. Client-side —
// the whole list is already in memory, same as the filters. Each key clicks in at a sensible default direction (see DEFAULT_DIR);
// clicking the active key again reverses it. Keys deliberately limited to Title / Stock / Sold (owner) — the raw numbers, no derived metric.
type SortKey = 'title' | 'stock' | 'sold';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'stock', label: 'Stock' },
  { key: 'sold', label: 'Sold' },
];
// The direction a key adopts when first picked: Title A→Z, but Stock/Sold high→low (the drop review wants the big piles and the dead
// sellers at the top). Re-clicking the active key toggles from here.
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = { title: 'asc', stock: 'desc', sold: 'desc' };

// The value a row sorts on for a given key. Title falls back to groupid so an untitled style still lands somewhere sensible.
function sortValue(r: InvStyleRow, key: SortKey): number | string {
  if (key === 'title') return (r.title || r.groupid).toLowerCase();
  if (key === 'stock') return r.local + r.amazon;
  return r.sold30;
}

// Above this many matches we swap the picture cards for a QUICK TITLE LIST (see the GATE note in the header). The list is cheap — no
// images — and its job is to show what is in the pile so the operator knows the next word to filter off (owner, 2026-07-23: "a quick
// title list that then prompts me to know what to filter off" — better than just raising the number and loading 74 pictures).
const CARD_GATE = 50;

// The text a filter step is matched against. Built once per row and cached. Lowercased here so each step is a plain indexOf.
function haystack(r: InvStyleRow): string {
  return `${r.title || ''} ${r.groupid} ${r.segment || ''}`.toLowerCase();
}

// Escape a user term so it can go inside a RegExp literally (a stray "." or "(" would otherwise be a metachar).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalise a size token for matching, so a typed "5" finds a stored "05" and "41" finds "41".
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

  // SIZE filter — a SINGLE value kept apart from the text steps so it can be swapped or cleared on its own (41 -> 40 as the customer
  // asks) without re-typing the text hunt. Filters to styles holding that size locally; each card then leads with that size's count.
  const [sizeInput, setSizeInput] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const sizeTarget = useMemo(() => (sizeFilter ? normSize(sizeFilter) : null), [sizeFilter]);
  // Does the size filter EXCLUDE styles that are sold out in that size? True for the standalone Size box (a "who's got a 41?" browse —
  // a style with none is noise). FALSE when the size was inferred from a pasted SKU like 0151183-ARIZONA-38: that is a targeted lookup
  // of ONE style, so we must still show its card (leading with 38, greyed at 0) rather than "No styles match" (owner, 2026-07-23).
  const [sizeStrict, setSizeStrict] = useState(true);

  // STOCK / SOLD worded filters — one active per metric, keyed by metric so a STOCK command and a SOLD command can both be on at once
  // (e.g. "loads of stock, barely selling" = STOCK MORE 20 + SOLD LESS 3). Each ✕ clears just its own.
  const [qtyFilters, setQtyFilters] = useState<Partial<Record<QtyMetric, QtyFilter>>>({});
  const setQtyFilter = useCallback((f: QtyFilter) => setQtyFilters((prev) => ({ ...prev, [f.metric]: f })), []);
  const clearQtyFilter = useCallback((metric: QtyMetric) => setQtyFilters((prev) => {
    const next = { ...prev };
    delete next[metric];
    return next;
  }), []);

  // The command cheatsheet, behind an "i" — the search commands are a niche power feature, so they live in a toggle rather than a
  // permanent hint that shouts at every operator (owner). Grows as more commands land (SOLD MORE, …).
  const [showHelp, setShowHelp] = useState(false);

  // Sort mode — default Title A→Z, matching the order the server already returns so the first view is unchanged.
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Pick a key: re-clicking the active one reverses; a new key adopts its default direction. Written as two plain setState calls off the
  // CURRENT sortKey (not nested inside a setSortKey updater) — nesting made the reverse toggle twice under React StrictMode's double-invoke
  // and appear to do nothing.
  const onSort = useCallback((key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  }, [sortKey]);

  // CUT: groupids the operator has hidden by hand — the manual trim for a straggler a text step can't drop without over-matching.
  // Purely view state: nothing is written, Restore or Reset brings them back.
  const [cut, setCut] = useState<Set<string>>(new Set());

  // Reset hands focus straight back to Contains so the next hunt starts by typing.
  const containsRef = useRef<HTMLInputElement>(null);

  // Fetch the whole list. On mount and again on Reset — Reset is the "start a fresh hunt" moment, so it doubles as refresh-from-DB
  // (mirrors PowerBuilder). Between refreshes the list is a snapshot filtered in the browser with no round-trip.
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

  // Nothing is listed until the operator has searched at least once — a text step OR a size filter counts. The full set is in memory
  // and IS what gets filtered; we simply don't render cards nobody asked for. Reset returns to this blank state.
  const activeQty = useMemo(() => Object.values(qtyFilters).filter(Boolean) as QtyFilter[], [qtyFilters]);
  const searched = steps.length > 0 || sizeFilter !== null || activeQty.length > 0;

  // Local stock this style holds in the filtered size (0 if none / no size filter).
  const sizeQtyOf = useCallback((r: InvStyleRow): number => {
    if (sizeTarget === null) return 0;
    let q = 0;
    for (const [k, v] of Object.entries(r.localSizes)) {
      if (normSize(k) === sizeTarget) q += v;
    }
    return q;
  }, [sizeTarget]);

  // Apply every text step in order (ANDed), then the size filter last: keep only styles with that size on the shelf.
  const filtered = useMemo(() => {
    let out = indexed;
    for (const s of steps) {
      const t = s.term.toLowerCase();
      if (s.op === 'has') {
        // CONTAINS stays a plain substring — the operator types partials ("ARIZ" must find "Arizona"), so narrowing has to be loose.
        out = out.filter((x) => x.hay.includes(t));
      } else {
        // DOES NOT CONTAIN matches WHOLE WORDS. A plain substring here is a footgun: excluding the colour "SAND" also matched the SAND
        // inside "SANDALS" and wiped every result (owner, 2026-07-23). \b…\b so an exclusion only drops the word you named, not a longer
        // word that happens to start with it. Built once per step, not per row.
        const re = new RegExp(`\\b${escapeRegExp(t)}\\b`);
        out = out.filter((x) => !re.test(x.hay));
      }
    }
    if (sizeTarget !== null && sizeStrict) out = out.filter((x) => sizeQtyOf(x.row) > 0);
    // STOCK / SOLD commands, last: numeric compares (ANDed). Strict (< / >), so "STOCK LESS 10" excludes exactly-10.
    for (const f of activeQty) {
      out = out.filter((x) => {
        const v = metricValue(x.row, f.metric);
        return f.op === 'less' ? v < f.n : v > f.n;
      });
    }
    return out.map((x) => x.row);
  }, [indexed, steps, sizeTarget, sizeStrict, sizeQtyOf, activeQty]);

  // What actually shows = the text-filtered rows minus the hand-cut ones.
  const visible = useMemo(() => filtered.filter((r) => !cut.has(r.groupid)), [filtered, cut]);
  const cutInView = filtered.length - visible.length;

  // Apply the sort mode to what's on screen. groupid is the stable tie-break (always ascending) so equal stock/sold rows keep a fixed
  // order rather than jittering between renders.
  const sortedVisible = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...visible].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const d = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      if (d === 0) return a.groupid.localeCompare(b.groupid);
      return d * dir;
    });
  }, [visible, sortKey, sortDir]);

  // Over the gate — too many matches to paint pictures for; show the quick title list instead (below).
  const overGate = visible.length > CARD_GATE;

  // FIND: turn whatever is in the boxes into steps, then clear the boxes. Blank boxes are ignored.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const next: FilterStep[] = [];
    // A trailing "-38" / "-42.5" on a groupid-shaped term is a SIZE, not part of the code (operators paste a full SKU like
    // 0151183-ARIZONA-38 when they mean "that style, in 38"). The groupid never carries the size, so the raw term matches nothing.
    // Split it off into the Size box: the search then narrows to the style AND each card leads with that size's count / rack (owner,
    // 2026-07-23). Only fires when the term STARTS with a code (a digit then a dash, i.e. a real groupid), so a hyphen in ordinary
    // title text isn't mistaken for a size. An explicitly typed Size box always wins over one inferred from the term.
    let containsTerm = contains.trim();
    let sizeFromTerm = '';
    let nextQty: QtyFilter | null = null;
    // FIRST CHECK (owner): a worded "STOCK/SOLD LESS <n>" / "…MORE <n>" in the Contains box is a quantity filter, not a text find, so it
    // is matched BEFORE the text/SKU logic — otherwise "STOCK" would leak through as a title substring and match nothing. The keyword is
    // caps because the box force-uppercases input. Matched, it branches here: set the filter and consume the term (no text step). Any
    // integer or one decimal place is accepted; STOCK compares combined local+Amazon, SOLD the 30-day sold count.
    const qtyMatch = containsTerm.match(/^(STOCK|SOLD)\s+(LESS|MORE)\s+(\d+(?:\.\d+)?)$/);
    if (qtyMatch) {
      nextQty = { metric: qtyMatch[1] === 'STOCK' ? 'stock' : 'sold', op: qtyMatch[2] === 'LESS' ? 'less' : 'more', n: Number(qtyMatch[3]) };
      containsTerm = '';
    } else {
      const sizeMatch = containsTerm.match(/^(\d[\dA-Z]*-.+?)-(\d{1,2}(?:\.\d)?)$/);
      if (sizeMatch) { containsTerm = sizeMatch[1]; sizeFromTerm = sizeMatch[2]; }
    }
    if (containsTerm) next.push({ op: 'has', term: containsTerm });
    if (notContains.trim()) next.push({ op: 'not', term: notContains.trim() });
    const size = sizeInput.trim() || sizeFromTerm;
    if (next.length === 0 && !size && !nextQty) return;
    if (nextQty) setQtyFilter(nextQty);
    if (next.length > 0) setSteps((prev) => [...prev, ...next]);
    if (size) {
      setSizeFilter(size);
      // Strict (exclude sold-out) only when the size was typed in its own box; a size split off a pasted SKU is a targeted lookup, so
      // it must not hide the one style it points at just because that size is out.
      setSizeStrict(!!sizeInput.trim());
    }
    setContains('');
    setNotContains('');
    setSizeInput('');
    containsRef.current?.focus();
  }

  // Cut one row from the view. (No row click to stop propagating from anymore — the card owns its own clicks — so this is a plain hide.)
  function onCut(groupid: string) {
    setCut((prev) => {
      const next = new Set(prev);
      next.add(groupid);
      return next;
    });
  }

  // Restore all cuts without touching the filter or re-reading the DB — the light undo for a mis-cut.
  function restoreCuts() {
    setCut(new Set());
  }

  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setSizeInput('');
    setSizeFilter(null);
    setSizeStrict(true);
    setQtyFilters({});
    setSortKey('title');
    setSortDir('asc');
    setCut(new Set());
    // Reset also RE-READS the list from the DB, so stock figures are fresh at the start of a new hunt (owner — as in PowerBuilder).
    loadStyles();
    containsRef.current?.focus();
  }

  return (
    <AppShell title="Inventory" subtitle="Find stock by title, groupid or segment">
      {/* ---- Command bar (sticky) ------------------------------------------------------------------------------------------
          Stays pinned to the top while cards scroll under it. -mx-4 px-4 + a solid backdrop so scrolling cards don't show through. */}
      <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200 bg-slate-50/95 px-4 pb-3 pt-1 backdrop-blur">
        <form onSubmit={onFind} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
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
            {/* Size — its own box. Filters to styles with that size in LOCAL stock; each card then leads with that size's count. */}
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
            <button
              type="button"
              onClick={onReset}
              title="Clear the search and re-read stock from the database"
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Reset
            </button>
            {/* Command cheatsheet toggle — quiet "i" rather than a permanent tip line (owner: the commands are a power feature, don't
                shout them at everyone). Opens the brief list below. */}
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              title="Search commands"
              aria-expanded={showHelp}
              className={`flex items-center rounded-md border px-2 py-2 ${showHelp ? 'border-slate-400 bg-slate-100 text-slate-600' : 'border-slate-300 text-slate-400 hover:bg-slate-50'}`}
            >
              <QuestionMarkCircleIcon className="h-5 w-5" />
            </button>
          </div>

          {/* The cheatsheet — hidden until the "i" is pressed. Kept VERY brief (owner); one line per command. Grows with more commands. */}
          {showHelp && (
            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="mb-1 font-medium uppercase tracking-wide text-slate-400">Commands — type in Contains, then Find</div>
              <ul className="space-y-1">
                <li>
                  <span className="font-mono text-slate-700">STOCK LESS 10</span> · <span className="font-mono text-slate-700">STOCK MORE 5</span>
                  <span className="text-slate-400"> — filter by total stock (local + Amazon)</span>
                </li>
                <li>
                  <span className="font-mono text-slate-700">SOLD LESS 3</span> · <span className="font-mono text-slate-700">SOLD MORE 10</span>
                  <span className="text-slate-400"> — filter by units sold in the last 30 days</span>
                </li>
              </ul>
            </div>
          )}

          {/* Breadcrumb of applied steps + the row count, at the top where the operator uses it to decide whether to narrow again. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
            <span className="mr-1 whitespace-nowrap text-slate-500">
              {searched ? (
                <>Rows: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {rows.length}</span></>
              ) : (
                <span className="text-slate-400">{rows.length} styles ready to search</span>
              )}
            </span>
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
            {/* Only the STRICT size filter (typed in its own box) earns a removable chip here — it actually narrows the list, so its ✕
                changes the result. A size split off a pasted SKU narrows nothing (it only leads the one card with that size), so a
                removable "filter" chip would be a no-op affordance — ✕ leaves the same rows on screen (owner, 2026-07-23). That size is
                shown ON the card instead ("Size 38 — 0 on the shelf"); to drop it, Reset. */}
            {sizeFilter && sizeStrict && (
              <>
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700">
                  Size {sizeFilter} · local
                  <button
                    type="button"
                    // Clearing hands focus straight back to Contains, so the next hunt starts by typing — same as the stock chip (owner).
                    onClick={() => { setSizeFilter(null); containsRef.current?.focus(); }}
                    title="Clear size filter"
                    className="ml-0.5 rounded text-indigo-400 hover:text-indigo-700"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </>
            )}
            {/* STOCK / SOLD chips — real narrowing filters, so each earns a removable ✕ like the size chip: clearing changes the result.
                One chip per active metric; the ✕ clears just that metric and hands focus back to Contains for the next command (owner). */}
            {activeQty.map((f) => (
              <span key={f.metric} className="flex items-center gap-1.5">
                <span className="text-slate-300">|</span>
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                  {f.metric === 'stock' ? 'Stock' : 'Sold 30d'} {f.op === 'less' ? '<' : '>'} {f.n}
                  <button
                    type="button"
                    onClick={() => { clearQtyFilter(f.metric); containsRef.current?.focus(); }}
                    title={`Clear ${f.metric} filter`}
                    className="ml-0.5 rounded text-emerald-400 hover:text-emerald-700"
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </span>
              </span>
            ))}
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

            {/* SORT — inside the command box, pushed to the RIGHT of the breadcrumb (ml-auto) so the filter badges keep the left (owner).
                Only shown once there is something to sort. Active key is filled and carries its ↑/↓; clicking it again reverses (onSort). */}
            {searched && filtered.length > 0 && (
              <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
                <span className="mr-0.5 text-xs text-slate-400">Sort</span>
                {SORTS.map((s) => {
                  const active = sortKey === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => onSort(s.key)}
                      className={
                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition ' +
                        (active
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')
                      }
                    >
                      {s.label}
                      {active && <span className="text-brand-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* ---- Results ----------------------------------------------------------------------------------------------------- */}
      {loading && <p className="text-sm text-slate-400">Loading stock…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}


      {/* Opening state — nothing searched yet. */}
      {!loading && !error && !searched && (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 shadow-sm">
          Type what you are looking for and press Find.
        </div>
      )}

      {/* Searched, but too many for pictures — the QUICK TITLE LIST. No images (that is the over-fetch guard); it exists to show what
          is in the pile so the operator can spot the word to filter off. Once narrowed under the gate, the picture cards take over. */}
      {!loading && !error && searched && overGate && (
        <div>
          <p className="mb-2 text-sm text-slate-600">
            <span className="font-semibold text-slate-800">{visible.length}</span> styles match — narrow under {CARD_GATE} to see the pictures. What can you rule out?
          </p>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <ul className="divide-y divide-slate-100">
              {sortedVisible.map((r) => (
                <li key={r.groupid} className="group flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                  <span className="w-32 shrink-0 truncate font-mono text-xs text-slate-500">{r.groupid}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{r.title || <span className="text-slate-400">—</span>}</span>
                  {/* Combined stock (local + Amazon) — the "what have we got right now" number the STOCK filter works on. */}
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500" title={`${r.local} local + ${r.amazon} at Amazon`}>
                    <span className={combinedStock(r) ? 'font-semibold text-slate-700' : 'text-slate-400'}>{combinedStock(r)}</span> stock
                  </span>
                  {/* Units sold in the last 30 days — the "is it moving" number the SOLD filter works on; read next to stock for a drop call. */}
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500" title="Units sold in the last 30 days (all channels)">
                    <span className={r.sold30 ? 'font-semibold text-slate-700' : 'text-slate-400'}>{r.sold30}</span> sold
                  </span>
                  {/* On-shelf count — a size filter makes it the count FOR THAT SIZE, matching the picture cards. */}
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    <span className={((sizeFilter ? sizeQtyOf(r) : r.local) ? 'font-medium text-slate-600' : '')}>
                      {sizeFilter ? sizeQtyOf(r) : r.local}
                    </span> on shelf
                  </span>
                  {/* Cut straight from the list — rule a style out here without waiting to see its picture. */}
                  <button
                    type="button"
                    onClick={() => onCut(r.groupid)}
                    title="Cut from list (Restore or Reset brings it back)"
                    className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Searched and narrow enough — the browse. */}
      {!loading && !error && searched && !overGate && (
        <div className="space-y-3">
          {sortedVisible.map((r) => (
            <div key={r.groupid} className="group relative">
              <InvStyleCard row={r} sizeFilter={sizeFilter} />
              {/* Cut — muted until the card is hovered, then reddens. Sits top-right, out of the way of the picture and sizes. */}
              <button
                type="button"
                onClick={() => onCut(r.groupid)}
                title="Cut from list (Restore or Reset brings it back)"
                // Always faintly visible (owner, 2026-07-23) — a muted grey cross so the cut is discoverable without hovering, then
                // reddens on hover to confirm it's the remove control. The old opacity-0/group-hover made it invisible until the cursor
                // was over the card, so it read as missing.
                className="absolute right-2 top-2 rounded p-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          ))}

          {visible.length === 0 && cutInView > 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
              All {cutInView} matching {cutInView === 1 ? 'style is' : 'styles are'} cut.{' '}
              <button type="button" onClick={restoreCuts} className="text-brand-600 underline">Restore</button> to bring {cutInView === 1 ? 'it' : 'them'} back.
            </div>
          )}
          {filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 shadow-sm">
              No styles match. <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
