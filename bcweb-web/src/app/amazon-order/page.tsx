'use client';
/*
=======================================================================================================================================
Page: /amazon-order  (Amazon Order module home)
=======================================================================================================================================
Purpose: Landing screen — every managed Amazon SKU with its Amazon profit (skumap.amzprofit, per unit) and profit over the last 30
         days (unit_profit x amzfeed.amzsold), best performers first. Single GET on mount via useApiQuery; the whole ~520-row set is
         fetched once and searched CLIENT-SIDE with no round-trip, same idea as /inventory.

SEARCH: two boxes, Include / Does not contain. Enter (or the Add button) commits whatever is typed as a STEP rather than filtering
        live on every keystroke, so multiple narrowings stack ("ives" then "black" = ives styles, excluding black). Committed steps
        show no chips of their own (owner, 2026-08-20 — "they get messy") — Reset clears them, same as every other filter on the
        screen. All Include steps must match (ANDed substrings); no Exclude step may match. Exclude matches WHOLE WORDS ONLY via a
        \b...\b boundary — a plain substring would let excluding a colour like "SAND" also drop anything containing "SANDALS" (the
        exact footgun /inventory's filter hit and fixed, 2026-07-23; same fix reused here).

SORT: every column header is clickable. Same click-to-reverse gesture as /inventory: picking a new column adopts its default
      direction (numeric columns start high-to-low, text starts A-Z), clicking the active column again flips it. Client-side, like
      the filter — the whole list is already in memory.

SELECTION + CUT: ONE highlight, not two. The blue row is where you are AND what an action will hit — arrowing Up/Down moves it,
      clicking sets it, Enter and the "Cut (n)" button both act on it. This screen used to run a keyboard cursor (a hairline on the
      SKU cell) alongside a separate multi-select (a full row fill), which is what useListCursor is built for and what /inventory
      does. Here it made the screen hard to hold on to: the singular "where was I" marker was the faintest thing on screen, the
      louder fill meant something else, and the two could point at different rows (owner, 2026-08-20 — "only one type of select so
      it's clear what I'm on and cutting"). The cursor still exists underneath as the keyboard's position, it just has no separate
      look — every move writes the selection, so they can never disagree.

      Shift-click still extends a contiguous range from the anchor and Ctrl/Cmd-click still toggles a single row in or out, so bulk
      cutting a block is unchanged. Cut is a view-only hide (not a delete), same idea as Inventory's Cut; the row's own X cuts just
      that row regardless of what's selected. Cut rows drop out of the keyboard list too, so arrowing never lands on one. Reset
      restores every cut row, same as it clears the search.

      useListCursor deliberately leaves a focused INPUT alone (arrows move its caret, not the list — the hook's normal, correct
      behaviour everywhere else). The Order box is the one place that's wrong: it's a column of numbers down the row axis, so
      Up/Down should walk rows exactly like it does on the row itself. It gets its own onKeyDown that intercepts ONLY
      ArrowUp/ArrowDown, moves the shared cursor, and refocuses the box on the new row — typing, Tab, and every other key still
      belong to the input untouched.

COVERAGE FILL: one-click auto-fill, see applyCoverage for the exact numbers. Targets every row CURRENTLY ON SCREEN (`visible`),
      ranks what it just filled and sorts the table to it (via the shared `manualOrder`), and is cleared by Reset. Fills Order
      (what to buy from the supplier). The lit rate is remembered PER VIEW (coverageByView) — fill Winners at 2 months and
      Potential at 1/2 and each list shows its own rate still lit when you flick back to it.

SEND TO ORDER STATUS: the "Send to Order Status" button turns the Basket scratchpad into real rows — loops POST /order-status-add per SKU (the
      same endpoint Order Status's own "add a line" uses), one un-placed orderstatus row per unit, ordertype 3/Amazon. Targets EVERY
      row with a positive Order value, not just what's currently visible, so a value typed before a filter/cut isn't silently dropped.
      Birkenstock is never orderable here (isBirkenstock) — still ordered separately, in bulk, ~6 months ahead (CLAUDE.md) — its Order
      box is disabled rather than silently zeroed, so it's clear why nothing happens. A loss-making SKU (isLoss — last Amazon sale
      made £0 or less) is NOT blocked from a manual Order entry, only from the Rate Order auto-fill (applyCoverage, owner 2026-08-11).
      Inline confirm states the total before writing
      anything (this is a real DB write, not more scratchpad editing); a succeeding row clears its own box and bumps a session-only
      `orderedBump` on top of the displayed FBA Total, so re-checking the same SKU later in the sitting doesn't still read as needing
      an order — that bump is NOT a DB figure and is lost on reload, same as the rest of this scratchpad.

      Pick (send local stock to Amazon) has been pulled from this screen for now — revisit later (owner, 2026-08-11).

LOAD ORDER: a third quick preset, mutually exclusive with Winners/Potential/Recycle (owner, 2026-08-20) — show every row with a
      positive number currently in Order, ACROSS THE FULL ~520-row set, regardless of search/Winners/Potential: it stands alone
      rather than stacking on top of them, so a row filled while a different filter was active never silently drops out of view. A
      LIVE filter, not a snapshot: re-evaluates as orderQty changes, so typing a value while it's on brings the row straight in
      without a re-toggle. The row currently FOCUSED is always exempt from this filter regardless of what it reads
      (focusedOrderCode) — otherwise backspacing a value down through 0 on the way to clearing it would yank the row, and the
      input being typed into, out of the list mid-edit.

RECYCLE: a fourth preset, mutually exclusive with the others — SKUs that HAVE sold at some point, just not within the last 6
      months, and don't already qualify for Winners or Potential (owner, 2026-08-20). Distinct from "never sold" (last_sold ===
      null, excluded): this is stock with a track record that's gone quiet, worth a fresh look (reprice, re-list, bundle) rather
      than the dead-stock problem a never-sold row represents.
=======================================================================================================================================
*/

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon, ChevronUpIcon, ChevronDownIcon, TrophyIcon, SparklesIcon, ShoppingCartIcon,
  FunnelIcon, TrashIcon, ClockIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import CopyButton from '@/components/CopyButton';
import { getAmazonOrderList, addOrderLine, AmazonOrderRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useListCursor } from '@/lib/useListCursor';
import { useAuth } from '@/contexts/AuthContext';

const NO_ROWS: AmazonOrderRow[] = [];

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

// Escape a typed term so it can sit inside a RegExp literally (a stray "." or "(" would otherwise be a metacharacter).
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function haystack(r: AmazonOrderRow): string {
  return `${r.title || ''} ${r.code} ${r.groupid}`.toLowerCase();
}

// Shared by `filtered` below and by addInclude's auto-reset check — same include/exclude test against a haystack, since
// addInclude needs to try a prospective term set BEFORE committing it to state (state updates aren't visible synchronously).
function matchesSearch(hay: string, incTerms: string[], excRes: RegExp[]): boolean {
  if (incTerms.some((t) => !hay.includes(t))) return false;
  if (excRes.some((re) => re.test(hay))) return false;
  return true;
}
function hasSearchMatch(rows: AmazonOrderRow[], includes: string[], excludes: string[]): boolean {
  const incTerms = includes.map((t) => t.toLowerCase());
  const excRes = excludes.map((t) => new RegExp(`\\b${escapeRegExp(t.toLowerCase())}\\b`));
  return rows.some((r) => matchesSearch(haystack(r), incTerms, excRes));
}

// Birkenstock is ordered separately, in bulk, ~6 months ahead (CLAUDE.md) — never orderable from this per-SKU screen.
function isBirkenstock(r: AmazonOrderRow): boolean {
  return (r.supplier || '').toUpperCase() === 'BIRKENSTOCK';
}

// A SKU whose last Amazon sale made £0 or less shouldn't get MORE bought in for it (owner, 2026-08-11) — unknown profit
// (unit_profit === null) is not treated as a loss, since there's nothing to judge it on.
function isLoss(r: AmazonOrderRow): boolean {
  return r.unit_profit !== null && r.unit_profit <= 0;
}

// SOLD IN 6MO — unit_profit (skumap.amzprofit) is STICKY (route header, amazon-order-list.js): a SKU that sold once over a year
// ago and never since still carries that figure, so it can pass Potential's >£3 test on a stale number. This reads last_sold
// (MAX(sales.solddate), also computed fresh at request time — see below) instead. A never-sold SKU (last_sold === null) fails.
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30.44 * 6;
function isRecentlySold(r: AmazonOrderRow, cutoffMs: number): boolean {
  if (!r.last_sold) return false;
  return new Date(r.last_sold + 'T00:00:00Z').getTime() >= cutoffMs;
}

// A ref callback that keeps `set` fed with the element's live height, and zeroed when it unmounts. Used for the two pieces of
// sticky chrome (the control panel and the column-header row) — see stickyOffset in the component for what the numbers are for.
// ResizeObserver fires once on observe, so the first measurement arrives without having to take it by hand.
function measureHeight(set: (h: number) => void) {
  let ro: ResizeObserver | null = null;
  return (el: HTMLElement | null) => {
    ro?.disconnect();
    ro = null;
    if (!el) { set(0); return; }
    ro = new ResizeObserver(() => set(el.getBoundingClientRect().height));
    ro.observe(el);
  };
}

// The four coverage-fill presets — see applyCoverage in the component for what clicking one does.
const COVERAGE_OPTIONS = [0.5, 1, 2, 3] as const;

// The four mutually-exclusive views a rate fill can be scoped to — the three presets plus the unfiltered list. Used to remember a
// rate PER VIEW (see coverageByView) so flicking between Winners and Potential shows each one's own rate still lit.
type ViewKey = 'all' | 'winners' | 'potential' | 'recycle' | 'basket';
const NO_COVERAGE: Record<ViewKey, number | null> = { all: null, winners: null, potential: null, recycle: null, basket: null };

// LOCAL DRAFT SAVE — Order is still not sent anywhere until the button is pressed (owner decision), but it's now saved to THIS
// BROWSER via localStorage (debounced, see the save effect below) so a reload or an accidental tab close doesn't lose an afternoon
// of typing. Deliberately NOT server-side: per-browser only, doesn't follow an operator to a different machine, and two tabs open
// at once will clobber each other's save (last write wins) — acceptable for a solo scratchpad, revisit if that turns out to matter
// (owner, 2026-08-11).
const DRAFT_KEY = 'bcweb:amazon-order-draft';
// A draft older than this is more likely to be stale (stock/sales have moved on) than useful — dropped silently on load rather than
// resurrected, same as any other browser-only state that's outlived its relevance.
const DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
interface AmazonOrderDraft {
  orderQty?: Record<string, string>;
  savedAt?: number;
}
// 'order_qty' is NOT a row field (it's the client-only Order scratchpad, keyed separately by code) — sortValue can't resolve it,
// so `sorted` below special-cases it by reading the live orderQty state directly.
type SortKey = 'code' | 'local_stock' | 'fba_live' | 'fba_total' | 'units_7d' | 'units_30d' | 'unit_profit' | 'profit_30d' | 'barcode' | 'amz_sku' | 'supplier' | 'order_qty';
// Reading order: identity (SKU, then the Order scratchpad rendered right after it — see below) -> what's in stock (local, then
// FBA) -> how it's selling -> what it's made -> the identifiers you'd look up but don't need to read every time (barcode/SKU/
// supplier), pushed to the end so they scroll off rather than crowd the working columns (owner request, 2026-08-07).
const COLUMNS: { key: SortKey; label: string; title?: string; align: 'left' | 'right' }[] = [
  { key: 'code', label: 'SKU (size)', align: 'left' },
  { key: 'local_stock', label: 'Local', title: 'Sellable local stock, excluding anything staged at C3-Amazon (that\'s counted under FBA Total instead)', align: 'right' },
  { key: 'fba_live', label: 'FBA Live', title: 'Sellable-now FBA stock (amzfeed.amzlive)', align: 'right' },
  { key: 'fba_total', label: 'FBA Total', title: 'Live + inbound FBA stock, plus anything picked and staged at C3-Amazon awaiting DPD collection, plus not-yet-arrived Amazon order lines (TO PLACE + ON ORDER)', align: 'right' },
  { key: 'units_30d', label: 'Sold (30)', title: 'Units sold, last 30 days, net of returns', align: 'right' },
  { key: 'units_7d', label: 'Sold (7)', title: 'Units sold, last 7 days', align: 'right' },
  { key: 'unit_profit', label: 'Unit profit', title: "Per-unit profit of the SKU's last Amazon sale (skumap.amzprofit)", align: 'right' },
  { key: 'profit_30d', label: 'Profit (30d)', title: 'unit_profit x Sold (30d)', align: 'right' },
  { key: 'barcode', label: 'Barcode', title: 'skumap.ean, trailing B stripped', align: 'left' },
  { key: 'amz_sku', label: 'Amazon SKU', title: 'Amazon Seller SKU (amzfeed.sku)', align: 'left' },
  { key: 'supplier', label: 'Supplier', align: 'left' },
];
// Text columns default A-Z; every numeric column defaults high-to-low (the biggest number is usually the interesting end).
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  code: 'asc', local_stock: 'desc', fba_live: 'desc', fba_total: 'desc', units_7d: 'desc', units_30d: 'desc',
  unit_profit: 'desc', profit_30d: 'desc', barcode: 'asc', amz_sku: 'asc', supplier: 'asc', order_qty: 'desc',
};

// COLUMN GROUPS — the table is really four blocks wearing ten columns: identity (SKU), stock on hand (Local / FBA Live / FBA
// Total), demand (Sold 30 / Sold 7), the operator's own input (Basket), then money (Unit profit / Profit 30d). A hairline on the
// FIRST column of each block gives the eye something to anchor on when reading across a ten-wide row, and it encodes the real
// shape of the data rather than decorating it. Deliberately not zebra striping: the rows already carry three background states
// (hover, selected, expanded) and alternating fills would fight all of them.
const GROUP_START: ReadonlySet<SortKey> = new Set<SortKey>(['local_stock', 'units_30d', 'order_qty', 'unit_profit']);

// The value a row sorts on for a given key. Nulls sort last regardless of direction (an unknown price/profit is not "small").
// 'order_qty' isn't a row field — the `sorted` memo special-cases it before ever calling this — but is still a valid SortKey, so
// it's guarded here too rather than left to fall through to an `r[key]` index TypeScript can't type against AmazonOrderRow.
function sortValue(r: AmazonOrderRow, key: SortKey): number | string | null {
  if (key === 'order_qty') return null;
  if (key === 'barcode' || key === 'amz_sku' || key === 'supplier') return r[key] ? r[key]!.toLowerCase() : null;
  return r[key];
}

// Shared <th> renderer — pulled out so the SKU column can be rendered on its own (Order slot in right after it) while every
// other column still comes from one shared COLUMNS.map.
function renderColumnHeader(
  c: { key: SortKey; label: string; title?: string; align: 'left' | 'right' },
  sortKey: SortKey, sortDir: 'asc' | 'desc', onSort: (key: SortKey) => void,
) {
  const active = sortKey === c.key;
  // The SKU column gets a tighter right pad (pr-2 instead of px-4's pr-4) — it's a fixed-width code, not prose, so the usual
  // breathing room just wastes width that the data columns further right can use instead (owner request, 2026-08-07).
  const pad = c.key === 'code' ? 'pl-3 pr-2' : 'px-3';
  // The SKU column is also pinned LEFT (in addition to the whole thead being pinned TOP — see the table container below), so it
  // stays on screen through both scroll axes at once. It needs its own opaque background (sticky cells sit outside the thead's
  // normal paint order once scrolled) and a higher z-index than every other header cell so it wins the corner where both stick.
  const stickyCode = c.key === 'code' ? 'sticky left-0 z-20 bg-slate-50' : '';
  // Group hairline — see GROUP_START. A touch darker in the header than in the body, so the divider reads as part of the header
  // rule rather than as a stray cell border.
  const group = GROUP_START.has(c.key) ? 'border-l border-slate-200' : '';
  return (
    <th
      key={c.key}
      title={c.title}
      onClick={() => onSort(c.key)}
      className={
        `cursor-pointer select-none whitespace-nowrap ${pad} py-1.5 font-medium hover:text-slate-700 ${stickyCode} ${group} ` +
        (c.align === 'right' ? 'text-right' : 'text-left')
      }
    >
      <span className={'inline-flex items-center gap-0.5 ' + (c.align === 'right' ? 'flex-row-reverse' : '')}>
        {c.label}
        {active && (sortDir === 'asc'
          ? <ChevronUpIcon className="h-3 w-3 text-slate-400" />
          : <ChevronDownIcon className="h-3 w-3 text-slate-400" />)}
      </span>
    </th>
  );
}

export default function AmazonOrderHome() {
  const { logout } = useAuth();
  const { data, error: loadError, isLoading: loading, refresh } = useApiQuery(
    ['amazon-order-list'],
    () => getAmazonOrderList(),
  );
  const rows: AmazonOrderRow[] = data?.rows ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // Committed steps — each Enter/Add stacks another one; multiple of the same kind AND together.
  const [includes, setIncludes] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [includeInput, setIncludeInput] = useState('');
  const includeInputRef = useRef<HTMLInputElement>(null);
  const [excludeInput, setExcludeInput] = useState('');

  // Stacking a new Include term on top of steps already narrowing the list can land on zero rows even though the term itself
  // exists elsewhere in the full ~520 — the earlier steps just ruled it out. Rather than silently show an empty table (the
  // operator typed a real term and has no way to tell "not found" apart from "found, but combined with what's already stacked"),
  // check the stacked result BEFORE committing: if it's empty, drop every prior Include/Exclude step and search fresh with just
  // this term (owner, 2026-08-24). If even that standalone search is empty, the empty state below says so plainly ("Nothing
  // found") rather than the misleading "No SKUs match" a stray irrelevant filter would otherwise imply.
  function addInclude() {
    const t = includeInput.trim();
    setIncludeInput('');
    if (!t || includes.includes(t)) return;
    const stacked = [...includes, t];
    if (hasSearchMatch(rows, stacked, excludes)) {
      setIncludes(stacked);
    } else {
      setIncludes([t]);
      setExcludes([]);
    }
    deselectAll();
  }
  function addExclude() {
    const t = excludeInput.trim();
    if (t && !excludes.includes(t)) { setExcludes((prev) => [...prev, t]); deselectAll(); }
    setExcludeInput('');
  }
  // Filter boxes are forced upper-case as typed (owner request, 2026-08-13) — purely cosmetic, since haystack()/escapeRegExp()
  // already lowercase both sides before matching.
  function onIncludeInputChange(e: React.ChangeEvent<HTMLInputElement>) { setIncludeInput(e.target.value.toUpperCase()); }
  function onExcludeInputChange(e: React.ChangeEvent<HTMLInputElement>) { setExcludeInput(e.target.value.toUpperCase()); }

  // WINNERS / POTENTIAL WINNERS — quick presets, not stacked steps: numeric tests on profit_30d/unit_profit, not text search terms.
  // Both are this screen's OWN thresholds (owner, 2026-08-07), deliberately NOT the shared Shopify/Amazon "≥2 units AND ≥£2/unit"
  // WINNERS test the pricing modules use:
  //   WINNERS            profit_30d > £30 — already making good money this month.
  //   POTENTIAL WINNERS  profit_30d < £30 BUT unit_profit > £3 AND sold within the last 6mo — the margin is there, it just hasn't
  //                      sold enough yet this month to show up as a winner; a candidate to push (stock/visibility), not a pricing
  //                      problem. The 6mo check guards against unit_profit's STICKY figure (see isRecentlySold) passing the margin
  //                      test on a sale from a year+ ago that's never repeated (owner, 2026-08-20).
  // Mutually exclusive (turning one on turns the other off): the two tests are opposite sides of the £30 line, so having both on at
  // once would always return nothing — a toggle GROUP reads correctly, two independent toggles would silently confuse.
  const [winnersOnly, setWinnersOnly] = useState(false);
  const [potentialOnly, setPotentialOnly] = useState(false);
  // RECYCLE — the mirror of Potential's 6mo check: SKUs that HAVE sold at some point, but not within the last 6 months, and don't
  // already qualify for Winners or Potential (owner, 2026-08-20). Not "never sold" (last_sold === null) — that's dead stock with
  // no track record at all, a different problem — this is stock that USED to move and might again, worth a fresh look (reprice,
  // re-list, bundle) rather than sitting untouched. The Winners/Potential exclusion is belt-and-braces: a genuinely stale last_sold
  // already fails Potential's own isRecentlySold test and Winners' profit_30d>30 (which implies a sale inside 30d), so the two
  // can't overlap in practice, but the explicit check keeps Recycle honest if either test's window ever changes independently.
  const [recycleOnly, setRecycleOnly] = useState(false);
  // Switching preset carries the rate-fill highlight with it rather than wiping it — see coverageByView below. Deliberately leaves
  // orderQty itself alone: a filter is a view change, not a "wipe what I've built up" action, same reasoning as onReset above.
  function toggleWinners() { setWinnersOnly((v) => !v); setPotentialOnly(false); setRecycleOnly(false); setOrdersOnly(false); deselectAll(); }
  function togglePotential() { setPotentialOnly((v) => !v); setWinnersOnly(false); setRecycleOnly(false); setOrdersOnly(false); deselectAll(); }
  function toggleRecycle() { setRecycleOnly((v) => !v); setWinnersOnly(false); setPotentialOnly(false); setOrdersOnly(false); deselectAll(); }

  // ORDERS ONLY — a third quick preset: show every row with a positive number currently sitting in the Order box, ACROSS THE WHOLE
  // ~520-row set — not just whatever search/Winners/Potential happened to be narrowing the screen down to at the time (owner,
  // 2026-08-20: a row filled while Potential was on shouldn't vanish from Load Order just because the screen's since flipped to
  // Winners). So it overrides those filters rather than stacking on top of them — see `filtered` below, which short-circuits to
  // this rule alone when ordersOnly is on. Mutually exclusive with Winners/Potential for the same reason Winners/Potential are
  // mutually exclusive with each other: combining would silently confuse which rule is actually governing the screen. A live
  // filter, not a snapshot — re-evaluates as orderQty changes, so typing a value while it's on doesn't require re-toggling to bring
  // the row in. Order scratchpad values, keyed by code — declared here (ahead of `filtered`/`sorted` below, which both need it)
  // rather than down with the rest of the Order UI state further down.
  const [orderQty, setOrderQty] = useState<Record<string, string>>({});
  const [ordersOnly, setOrdersOnly] = useState(false);
  function toggleOrdersOnly() {
    setOrdersOnly((v) => !v);
    setWinnersOnly(false); setPotentialOnly(false); setRecycleOnly(false);
    deselectAll();
  }

  // RATE MEMORY, PER VIEW — the rate strip's lit button is remembered against the view it was applied to, so filling Winners at 2
  // months and Potential at 1/2 and then flicking between the two shows each list's own rate still lit (owner, 2026-08-20).
  //
  // It used to be a single value wiped on every preset switch, for a good reason: a fill is computed against whatever rows were ON
  // SCREEN when it ran (applyCoverage below), so a rate left lit after the visible set changed underneath it read as "still
  // applied" when it wasn't. Keying it by view solves that same problem more precisely — the highlight now only shows on the list
  // it was actually applied to — while keeping the answer to "what did I fill this one at?" instead of throwing it away.
  //
  // Search steps deliberately get no slot of their own: they're freeform and unbounded, so they fold into whichever preset (or the
  // unfiltered list) is governing at the time. A rate re-tap is still the clear gesture, and still clears only the current view.
  const [coverageByView, setCoverageByView] = useState<Record<ViewKey, number | null>>(NO_COVERAGE);
  const viewKey: ViewKey = winnersOnly ? 'winners' : potentialOnly ? 'potential' : recycleOnly ? 'recycle' : ordersOnly ? 'basket' : 'all';
  const coverageMonths = coverageByView[viewKey];
  const anyCoverage = useMemo(() => Object.values(coverageByView).some((m) => m !== null), [coverageByView]);
  function setCoverageForView(months: number | null) {
    setCoverageByView((prev) => ({ ...prev, [viewKey]: months }));
  }
  // The row currently focused in an Order box is EXEMPT from the Orders-only filter below, regardless of what it currently reads —
  // otherwise backspacing a value down through 0 on the way to clearing it yanks the row (and the input you're typing into) out of
  // the list mid-edit, since the filter re-evaluates on every keystroke (owner, 2026-08-11 — "won't let me backspace to clear").
  const [focusedOrderCode, setFocusedOrderCode] = useState<string | null>(null);

  // Reset — clears every applied filter (and whatever's mid-typed in the box), restores every cut row, drops the selection, and
  // clears the sort/highlight the coverage fill applied. Deliberately does NOT touch the Order scratchpad itself (owner,
  // 2026-08-11) — that's a separately-saved draft (DRAFT_KEY) an operator can build up over several sittings, and Reset is a view
  // reset, not a "start the order over" action. Re-tapping an active rate button clears just the boxes it filled for the CURRENT
  // view (applyCoverage below); emptying the basket outright is Clear basket (clearBasket below), which is its own deliberate,
  // confirmed action for exactly that reason.
  function onReset() {
    setIncludes([]); setExcludes([]); setIncludeInput(''); setExcludeInput('');
    setWinnersOnly(false); setPotentialOnly(false); setRecycleOnly(false); setOrdersOnly(false);
    setCut(new Set()); setSelected(new Set());
    setCoverageByView(NO_COVERAGE);
    setManualOrder(null);
    setConfirmingOrder(false); setConfirmingClear(false); setOrderError(null); setOrderedBump({});
    includeInputRef.current?.focus();
  }

  const filtered = useMemo(() => {
    // Orders Only stands alone against the FULL row set — see its declaration above for why: it must not miss a row that has an
    // order just because search/Winners/Potential would otherwise have excluded it.
    if (ordersOnly) return rows.filter((r) => r.code === focusedOrderCode || (Number(orderQty[r.code]) || 0) > 0);
    let out = rows;
    if (includes.length > 0 || excludes.length > 0) {
      const incTerms = includes.map((t) => t.toLowerCase());
      const excRes = excludes.map((t) => new RegExp(`\\b${escapeRegExp(t.toLowerCase())}\\b`));
      out = out.filter((r) => matchesSearch(haystack(r), incTerms, excRes));
    }
    if (winnersOnly) out = out.filter((r) => r.profit_30d !== null && r.profit_30d > 30);
    if (potentialOnly) {
      // Potential Winners also requires a genuinely recent sale (owner, 2026-08-20) — unit_profit is STICKY (see isRecentlySold
      // above), so without this a SKU that sold once over a year ago and never since could still pass the >£3 margin test on a
      // stale figure.
      const cutoffMs = Date.now() - SIX_MONTHS_MS;
      out = out.filter((r) => r.profit_30d !== null && r.profit_30d < 30 && r.unit_profit !== null && r.unit_profit > 3 && isRecentlySold(r, cutoffMs));
    }
    if (recycleOnly) {
      // RECYCLE — see its declaration above: HAS sold before, just not within the last 6 months, and isn't already claimed by
      // Winners or Potential. last_sold === null (never sold at all) is excluded — that's dead stock with no track record, not
      // something that "used to move".
      const cutoffMs = Date.now() - SIX_MONTHS_MS;
      out = out.filter((r) => {
        if (!r.last_sold || isRecentlySold(r, cutoffMs)) return false;
        if (r.profit_30d !== null && r.profit_30d > 30) return false; // would be Winners
        if (r.profit_30d !== null && r.profit_30d < 30 && r.unit_profit !== null && r.unit_profit > 3) return false; // would be Potential
        return true;
      });
    }
    return out;
  }, [rows, includes, excludes, winnersOnly, potentialOnly, recycleOnly, ordersOnly, orderQty, focusedOrderCode]);

  const filtering = includes.length > 0 || excludes.length > 0 || winnersOnly || potentialOnly || recycleOnly || ordersOnly;

  const [sortKey, setSortKey] = useState<SortKey>('profit_30d');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Order box value for a row, as a sortable number — empty/non-numeric reads as null (sorts last), same "unknown isn't small"
  // rule as sortValue below. Not folded into sortValue itself since it isn't a row field — it's the client-only scratchpad.
  // useCallback (not a bare function) so the memos below can name it as a dependency — an unmemoized closure here makes the
  // React Compiler give up on `sorted`, and the bail-out then cascades into every memo derived from it (`visible`, `cursorKeys`).
  const orderQtyValue = useCallback((code: string): number | null => {
    const raw = orderQty[code];
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, [orderQty]);

  // MANUAL ORDER — an explicit row order, either set by a coverage-fill click (see applyCoverage below) or by picking the Order
  // column header. Both exist so the ranking is a SNAPSHOT taken at the moment of the click, not a live re-sort — editing a box
  // afterward would otherwise reorder the table out from under the operator's cursor mid-edit (owner, 2026-08-13: "confusing what
  // I'm working on"). Clicking any OTHER column header clears it — picking a different explicit sort overrides the snapshot on
  // purpose. Clicking the Order header again (to flip direction) retakes the snapshot from the current values.
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const onSort = (key: SortKey) => {
    if (key === 'order_qty') {
      const newDir: 'asc' | 'desc' = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[key];
      const dirMul = newDir === 'asc' ? 1 : -1;
      // Empty/unset boxes count as 0 here (not "sorts last" — see sortValue's rule for every other column), so ascending genuinely
      // starts with the untouched rows rather than burying them after every non-empty box (owner, 2026-08-13).
      const snapshot = [...filtered].sort((a, b) => {
        const av = orderQtyValue(a.code) ?? 0;
        const bv = orderQtyValue(b.code) ?? 0;
        const d = av - bv;
        if (d === 0) return a.code.localeCompare(b.code);
        return d * dirMul;
      }).map((r) => r.code);
      setManualOrder(snapshot);
      setSortKey(key);
      setSortDir(newDir);
      return;
    }
    setManualOrder(null);
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const byNormalSort = (a: AmazonOrderRow, b: AmazonOrderRow) => {
      // order_qty treats an empty box as 0, not "sorts last" (see onSort's snapshot above for why) — everything else keeps the
      // usual "an unknown value isn't small" rule.
      if (sortKey === 'order_qty') {
        const av = orderQtyValue(a.code) ?? 0;
        const bv = orderQtyValue(b.code) ?? 0;
        const d = av - bv;
        return d === 0 ? a.code.localeCompare(b.code) : d * dir;
      }
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Nulls always sort last, independent of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const d = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      if (d === 0) return a.code.localeCompare(b.code);
      return d * dir;
    };
    if (manualOrder === null) return [...filtered].sort(byNormalSort);
    // Manual order wins for any row it names (coverage-fill's just-computed rank); anything filtered in AFTER the fill (e.g. a
    // search term typed since) wasn't ranked, so it falls back to the normal sort and is appended after the ranked rows.
    const rank = new Map(manualOrder.map((code, i) => [code, i]));
    return [...filtered].sort((a, b) => {
      const ra = rank.get(a.code);
      const rb = rank.get(b.code);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return byNormalSort(a, b);
    });
  }, [filtered, sortKey, sortDir, manualOrder, orderQtyValue]);

  // Still NOT sent anywhere until the Order button is pressed (owner decision, 2026-08-07) — but now saved to THIS BROWSER (see
  // DRAFT_KEY above) so a reload or an accidental tab close doesn't lose it. Kept as free text rather than <input type="number">
  // so a half-typed value never gets silently clamped/rounded mid-entry.

  // LOAD the saved draft once on mount, before the autosave effect below is allowed to write anything (loadedDraftRef gates it) — see
  // the header comment for why: without the gate, autosave's own first run (still seeing the empty initial state) could schedule a
  // write that clobbers a just-loaded draft before this effect's setState has flushed.
  //
  // The two rule disables below are deliberate, not oversights. This is the one case both rules carve out in practice: a
  // mount-only read of an external store (localStorage) that can't move into a lazy useState initializer, because this page is
  // server-rendered and localStorage doesn't exist on the server — a lazy initializer would either throw during SSR or hydrate
  // with different values than the server produced. Date.now() is the draft's age check and setOrderQty applies what was read;
  // both run once, with [] deps, so there's no re-render cascade for the rules to protect against.
  const loadedDraftRef = useRef(false);
  useEffect(() => {
    /* eslint-disable react-hooks/purity, react-hooks/set-state-in-effect */
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as AmazonOrderDraft;
        if (draft.savedAt && Date.now() - draft.savedAt <= DRAFT_MAX_AGE_MS) {
          if (draft.orderQty) setOrderQty(draft.orderQty);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    loadedDraftRef.current = true;
    /* eslint-enable react-hooks/purity, react-hooks/set-state-in-effect */
  }, []);

  // AUTOSAVE — debounced 500ms after the last edit. Writing nothing (empty) clears any existing saved draft instead of persisting
  // an empty one, so Reset (which empties it) and simply deleting every typed number both tidy up storage.
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loadedDraftRef.current) return; // don't run before the load effect above has had its state update applied
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      if (Object.keys(orderQty).length === 0) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const savedAt = Date.now();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ orderQty, savedAt } satisfies AmazonOrderDraft));
    }, 500);
    return () => { if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current); };
  }, [orderQty]);

  // SEND TO ORDER STATUS — turns the Order scratchpad into real orderstatus rows via the same /order-status-add the Order Status
  // screen's own "add a line" uses (one un-placed row per unit, ordertype 3/Amazon). Targets EVERY row with a positive Order value,
  // not just what's currently visible — a value typed before a filter/cut shouldn't silently vanish from the submission just because
  // it scrolled out of view. Birkenstock is excluded by construction (isBirkenstock) even if a value somehow ended up in its box.
  // A loss-making SKU (isLoss) is NOT blocked here — the operator can still type a manual number and send it; only the Rate Order
  // auto-fill (applyCoverage, below) skips loss-makers on its own (owner, 2026-08-11).
  const rowByCode = useMemo(() => new Map(rows.map((r) => [r.code, r])), [rows]);
  const orderTargets = useMemo(() => {
    const out: { code: string; qty: number; supplier: string }[] = [];
    for (const [code, raw] of Object.entries(orderQty)) {
      const qty = Math.floor(Number(raw));
      const row = rowByCode.get(code);
      if (!row || !row.supplier || isBirkenstock(row) || !Number.isFinite(qty) || qty <= 0) continue;
      out.push({ code, qty, supplier: row.supplier });
    }
    return out;
  }, [orderQty, rowByCode]);
  const orderTotalUnits = useMemo(() => orderTargets.reduce((sum, t) => sum + t.qty, 0), [orderTargets]);

  const [confirmingOrder, setConfirmingOrder] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderProgress, setOrderProgress] = useState<{ done: number; total: number } | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  // Session-only running total of what's just been queued per SKU, added on top of fba_total for display — an immediate "yes it
  // went in" signal while submitOrder's refresh() (below) is still in flight. fba_total itself now counts not-yet-arrived Amazon
  // orderstatus lines server-side (owner, 2026-08-13 — "otherwise we may double order"), so once that refresh lands the real
  // number already includes what was just queued and the bump is cleared to avoid double-counting on screen.
  const [orderedBump, setOrderedBump] = useState<Record<string, number>>({});

  async function submitOrder() {
    setConfirmingOrder(false);
    if (orderTargets.length === 0) return;
    setOrdering(true); setOrderError(null);
    setOrderProgress({ done: 0, total: orderTargets.length });
    let queued = 0;
    const failed: string[] = [];
    for (let i = 0; i < orderTargets.length; i++) {
      const { code, qty, supplier } = orderTargets[i];
      const res = await addOrderLine(supplier, code, qty, 3);
      if (res.success) {
        queued++;
        setOrderQty((prev) => {
          const next = { ...prev };
          delete next[code];
          return next;
        });
        setOrderedBump((prev) => ({ ...prev, [code]: (prev[code] || 0) + qty }));
      } else if (res.return_code === 'UNAUTHORIZED') {
        setOrdering(false); setOrderProgress(null); logout(); return;
      } else {
        failed.push(code);
      }
      setOrderProgress({ done: i + 1, total: orderTargets.length });
    }
    setOrderProgress(null); setOrdering(false);
    if (failed.length > 0) setOrderError(`${failed.length} failed: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '…' : ''}`);
    // Re-fetch so fba_total picks up the lines just queued (it now counts not-yet-arrived orderstatus rows server-side) — the
    // client-only orderedBump was only ever a stand-in for this round trip, so it's dropped once the real number is in.
    if (queued > 0) {
      await refresh();
      setOrderedBump({});
    }
  }

  // CUT — a view-only hide, same idea as /inventory's Cut: the row stays in the DB and in `rows`, it just drops off screen until
  // Reset brings it back. Applied last, after search + sort, so cutting never fights with either. Declared HERE, ahead of
  // applyCoverage below, because that reads `visible` — the React Compiler can't preserve a memo that's consumed above its own
  // declaration (it assumes the value may still be mutated), and the bail-out cascades into basketOnScreenCount and cursorKeys.
  const [cut, setCut] = useState<Set<string>>(new Set());
  const visible = useMemo(() => sorted.filter((r) => !cut.has(r.code)), [sorted, cut]);

  // COVERAGE FILL — the 0.5/1/2/3 month buttons. units_30d is already a fixed-window monthly rate (amzfeed.amzsold — see the route
  // header), so demand for N months is simply units_30d * N. What we'd actually need to ORDER is that demand minus fba_total (live
  // + inbound — stock already at or on its way to Amazon). local_stock itself is still deliberately EXCLUDED from "on hand" — it
  // doesn't satisfy Amazon demand until picked, and there's no pick mechanism on this screen right now (pulled 2026-08-11, revisit
  // later). A SKU with nothing to order (already covered, or a loss-maker — isLoss, below) is left OUT of the fill entirely rather
  // than written as 0 — its box is simply left out of the fill. Fills every row CURRENTLY ON SCREEN (`visible`: after search +
  // Winners/Potential + cut), so filtering down first and then clicking a button targets exactly that working set — but ONLY those
  // rows: everything else already in the scratchpad (built up under a DIFFERENT filter view — e.g. a Potential fill, then flipping
  // to Winners and filling again) is left alone (owner, 2026-08-20 — "they should both exist"), so two different filter passes at
  // two different rates can build one combined order. Clicking the ALREADY-ACTIVE rate button is the clear gesture — it toggles
  // off, wiping just the currently-visible rows' boxes (not the whole scratchpad) back to empty. Clicking a DIFFERENT rate
  // recomputes only the visible rows, so a rate click always reflects one clean calculation for THIS view rather than layering
  // onto whatever was already typed or filled for these same rows before (owner, 2026-08-13). Also sets `manualOrder` to the
  // just-filled rows ranked biggest-need-first, so the table sorts to show what was just added without the operator having to
  // click the Order column (which isn't even a sortable header) — see the `sorted` memo above.
  function applyCoverage(months: number) {
    const visibleCodes = new Set(visible.map((r) => r.code));
    if (coverageMonths === months) {
      setCoverageForView(null);
      setOrderQty((prev) => {
        const next = { ...prev };
        for (const code of visibleCodes) delete next[code];
        return next;
      });
      setManualOrder(null);
      return;
    }
    setCoverageForView(months);
    // Birkenstock never gets an Order box (isBirkenstock, above) — filling it here would just write a number that's silently
    // discarded when the Order button is pressed, which reads as a bug rather than the deliberate exclusion it is. A loss-making
    // SKU (isLoss) is skipped the same way — no point buying in more of something that lost money last time it sold.
    const filled = visible
      .filter((r) => !isBirkenstock(r) && !isLoss(r))
      .map((r) => {
        const demand = r.units_30d * months;
        return { code: r.code, qty: Math.max(0, Math.ceil(demand - r.fba_total)) };
      })
      .filter((f) => f.qty > 0); // nothing to order — leave it out of the fill rather than write a 0
    setOrderQty((prev) => {
      const next = { ...prev };
      for (const code of visibleCodes) delete next[code]; // drop this view's old values before refilling
      filled.forEach(({ code, qty }) => { next[code] = String(qty); });
      return next;
    });
    setManualOrder(
      [...filled].sort((a, b) => (b.qty - a.qty) || a.code.localeCompare(b.code)).map((f) => f.code),
    );
  }

  // Cutting a row also wipes anything typed in its Order box (owner, 2026-08-13) — a cut SKU shouldn't silently keep contributing
  // to orderTargets/orderTotalUnits (both reach off-screen, so a cut row's leftover value would still be queued on Order/submit).
  function clearOrderQtyFor(codes: Iterable<string>) {
    setOrderQty((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const code of codes) {
        if (code in next) { delete next[code]; changed = true; }
      }
      return changed ? next : prev;
    });
  }
  function onCut(code: string) {
    setCut((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });
    clearOrderQtyFor([code]);
  }

  // CLEAR BASKET — empties the whole scratchpad in one go, off-screen rows included, and (via the autosave effect above, which
  // removes the key rather than persisting an empty draft) the saved draft with it. Deliberately its OWN action rather than part
  // of Reset: Reset is a view reset and leaves the basket alone on purpose (owner, 2026-08-11 — the basket is a draft built up
  // over several sittings), and re-tapping an active rate only wipes the rows currently on screen. Neither could empty a basket
  // assembled across several different filter views, which is exactly what this is for. Wipes the record outright, so any stray
  // zeroes or half-typed values left lying around go too.
  const [confirmingClear, setConfirmingClear] = useState(false);
  function clearBasket() {
    setConfirmingClear(false);
    setOrderQty({});
    // The rate highlights and the fill-ranked sort all describe a basket that no longer exists — every view's, not just this
    // one's, since the basket they were filling was shared across all of them.
    setCoverageByView(NO_COVERAGE);
    setManualOrder(null);
    // Load basket would otherwise leave the operator staring at an empty list, since everything it was showing just went — drop
    // back to the unfiltered view rather than an empty one that reads like a bug.
    setOrdersOnly(false);
    deselectAll();
  }

  // ON SCREEN / TOTAL — how much of the whole basket is visible right now, e.g. "10/41" when only 10 of the basket's 41 SKUs are
  // on screen (owner, 2026-08-20 — the flat count alone didn't say whether the basket was all here or mostly filtered/cut away
  // elsewhere). orderTargets itself deliberately reaches off-screen (a value typed before a filter/cut shouldn't silently drop
  // out of the real submission) — this is the on-screen SUBSET of it, display-only.
  const basketOnScreen = useMemo(() => {
    const visibleCodes = new Set(visible.map((r) => r.code));
    return orderTargets.filter((t) => visibleCodes.has(t.code));
  }, [orderTargets, visible]);
  const basketOnScreenCount = basketOnScreen.length;

  // BASKET COST — total spend of the ON-SCREEN portion of the basket only (owner, 2026-08-20 — "the cost should only be for
  // what's on the screen"), matching basketOnScreenCount above rather than the whole basket. cost = skusummary.cost (CLAUDE.md:
  // never skumap.cost) — some SKUs carry no numeric cost, so those units are flagged as unpriced rather than silently free.
  const basketCost = useMemo(() => {
    let total = 0;
    let unpriced = 0;
    for (const t of basketOnScreen) {
      const row = rowByCode.get(t.code);
      if (row?.cost === null || row?.cost === undefined) { unpriced += t.qty; continue; }
      total += t.qty * row.cost;
    }
    return { total, unpriced };
  }, [basketOnScreen, rowByCode]);

  // Keyboard movement over the visible rows. Keys are the VISIBLE rows only, so a cut row can never be arrowed onto and every move
  // lands on something on screen.
  //
  // The hook's cursor no longer has a look of its own: every keyboard move WRITES THE SELECTION (onMove below), so the blue row is
  // both "where I am" and "what Cut/Enter will take". That's a deliberate departure from /inventory, which keeps the two apart —
  // there the cursor is a reading position and the selection is a batch, and they usefully disagree. Here the operator is walking
  // a list deciding what to drop, so a position that isn't the thing being acted on was just a second highlight to keep track of.
  //
  // A keyboard move REPLACES the selection with the single row moved to, which also re-anchors: arrowing to a row and then
  // Shift-clicking another extends from where the keyboard left off, the same way it would after a plain click.
  const cursorKeys = useMemo(() => visible.map((r) => r.code), [visible]);
  const cursor = useListCursor({
    keys: cursorKeys,
    enabled: !loading && !error,
    onMove: (code) => selectOnly(code),
    // Enter cuts what's blue — the whole selection, not one row. With a single highlight there's no longer a "current row" that
    // could differ from it, so the old single-row Enter would have been cutting an invisible subset of what the screen shows.
    onEnter: () => cutSelected(),
  });

  // DETAIL EXPAND — barcode/Amazon SKU/supplier are looked up rarely, so they're not columns anymore (they were most of why the
  // table needed side-scrolling); double-clicking a row reveals them inline instead (owner request, 2026-08-13). Keyed by code,
  // same as cut/selected — a plain Set, since more than one row can be open at once and there's no ordering to track.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggleExpanded(code: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }

  // MULTI-SELECT for bulk cut — separate from the cursor above (see header comment). `anchorRef` is the last PLAIN click, which
  // Shift-click extends a range from; it deliberately does NOT move on a Shift or Ctrl/Cmd click, so several Shift-clicks in a row
  // keep adjusting the same range rather than re-anchoring each time.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchorRef = useRef<string | null>(null);
  // Select exactly this row and anchor on it — what a plain click does, and now what every keyboard move does too.
  function selectOnly(code: string) {
    setSelected(new Set([code]));
    anchorRef.current = code;
  }
  // Switching to a different filter (Winners/Potential/Load Order, or a search step added/removed) changes what's on screen out
  // from under the selection — the blue row could vanish from view, or land on a row the operator never chose. Rather than leave a
  // stale/invisible selection that Cut or Enter would still act on, moving filters clears it outright (owner, 2026-08-20).
  function deselectAll() {
    setSelected(new Set());
    anchorRef.current = null;
  }
  function onRowClick(e: React.MouseEvent, code: string) {
    cursor.setCursor(code);
    if (e.shiftKey && anchorRef.current) {
      const a = cursorKeys.indexOf(anchorRef.current);
      const b = cursorKeys.indexOf(code);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelected(new Set(cursorKeys.slice(lo, hi + 1)));
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code); else next.add(code);
        return next;
      });
      anchorRef.current = code;
    } else {
      setSelected(new Set([code]));
      anchorRef.current = code;
    }
  }
  // A cut row can't stay selected — without this, a single X-cut on a selected row leaves it in `selected` (invisible but still
  // counted), so the "Cut (n)" button would silently claim more rows than are actually left to cut.
  useEffect(() => {
    if (cut.size === 0) return;
    setSelected((prev) => {
      if (![...prev].some((c) => cut.has(c))) return prev;
      const next = new Set(prev);
      cut.forEach((c) => next.delete(c));
      return next;
    });
  }, [cut]);
  // Escape clears the cursor inside useListCursor. With one highlight that has to clear the selection too, or Escape would look
  // like it did nothing at all — the cursor has no separate mark left to remove. Watches the transition rather than the value, so
  // an empty selection at rest isn't constantly being re-set.
  const hadCursorRef = useRef(false);
  useEffect(() => {
    const has = cursor.cursorKey !== null;
    if (hadCursorRef.current && !has) setSelected(new Set());
    hadCursorRef.current = has;
  }, [cursor.cursorKey]);
  function cutSelected() {
    if (selected.size === 0) return;
    // Where the highlight lands afterwards: the first row below the block just cut that's still on screen, or the last survivor if
    // the block ran to the bottom. With a single highlight, finishing a cut with nothing blue means the operator has no idea where
    // they were — so the list closes up under the cut and the highlight stays put in the gap, ready for the next Enter.
    const survivors = cursorKeys.filter((c) => !selected.has(c));
    const firstCutIndex = cursorKeys.findIndex((c) => selected.has(c));
    const landing = survivors.length === 0
      ? null
      : survivors[Math.min(Math.max(firstCutIndex, 0), survivors.length - 1)];
    setCut((prev) => {
      const next = new Set(prev);
      selected.forEach((c) => next.add(c));
      return next;
    });
    clearOrderQtyFor(selected);
    if (landing === null) {
      setSelected(new Set());
    } else {
      cursor.setCursor(landing);
      selectOnly(landing);
    }
  }

  // Order box: Up/Down walks rows and keeps focus in the box (see the header comment for why this needs its own handler rather
  // than relying on useListCursor, which leaves focused inputs alone everywhere else).
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  function setInputRef(code: string) {
    return (el: HTMLInputElement | null) => {
      if (el) inputRefs.current.set(code, el); else inputRefs.current.delete(code);
    };
  }
  function onEditKeyDown(e: React.KeyboardEvent<HTMLInputElement>, code: string) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const i = cursorKeys.indexOf(code);
    if (i < 0) return;
    const nextI = e.key === 'ArrowUp' ? Math.max(i - 1, 0) : Math.min(i + 1, cursorKeys.length - 1);
    const nextCode = cursorKeys[nextI];
    if (nextCode === code) return; // already at an end — leave the caret alone rather than eat the keystroke for nothing
    e.preventDefault();
    cursor.setCursor(nextCode);
    selectOnly(nextCode); // the box's own Up/Down is still a keyboard move, so it moves the one highlight like any other
    const nextInput = inputRefs.current.get(nextCode);
    nextInput?.focus();
    nextInput?.select();
  }

  // ONE SCROLLBAR, NOT TWO — the table used to sit in its own bounded, scrollable box (max-h + overflow-auto) so the panel and
  // column headers stayed put while the rows moved. That worked, but it left two scroll contexts on one screen and the wheel did
  // different things depending on where the pointer happened to be sitting (owner, 2026-08-20 — "I keep scrolling in the wrong
  // place"). The page now has a single scrollbar, and the same two things stay put by sticking to the VIEWPORT instead: the panel
  // at the top, the column headers immediately under it.
  //
  // That second offset has to be the panel's LIVE height, not a constant: the panel grows and shrinks in normal use as search
  // chips wrap onto another line and as the send button gains its second line. A ResizeObserver keeps the number honest — hard
  // coding it would leave the headers either floating below the panel or tucked behind it, depending on the moment.
  const [panelHeight, setPanelHeight] = useState(0);
  const [headHeight, setHeadHeight] = useState(0);
  const panelRef = useMemo(() => measureHeight(setPanelHeight), []);
  const headRef = useMemo(() => measureHeight(setHeadHeight), []);

  // STICKY OFFSET — what a row has to clear to be fully visible: the panel plus the column-header row pinned under it. Every row
  // carries it as scroll-margin-top, because a browser scrolling a row into view knows nothing about position:sticky and will
  // happily park it underneath both. That's what made arrowing down lose the highlight behind the bar (owner, 2026-08-20).
  // useListCursor's header calls this out as the caller's job for exactly this reason: the hook can't know the height, the screen
  // can. The Basket input carries it too — Up/Down in a box moves focus to the next row's box (onEditKeyDown), and the browser
  // scrolls the newly focused INPUT into view, not the row around it.
  const stickyOffset = panelHeight + headHeight;

  return (
    <AppShell title="Amazon Order" backHref="/dashboard" backLabel="Dashboard">
      {/* CONTROL PANEL — two bands, one per half of the working loop: row 1 NARROWS the list (search steps, presets, cut/reset),
          row 2 FILLS what's left and SENDS it. It used to be five: search, presets+actions, rate strip, counts, chips — each
          behind its own divider, together eating about 15rem before a single row of data. Folding it to two gives roughly seven
          more rows on screen permanently, which on a ~520-row list is the difference that matters.

          Sticky to the viewport top, so the controls never scroll out of reach while working down the list — with the table's own
          scrollbox gone (see panelHeight above) this is what keeps them there, not a nicety (owner request, 2026-08-13 — "too
          much scrolling"). */}
      <div ref={panelRef} className="sticky top-0 z-30 mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        {/* ROW 1 — NARROW. Everything that decides WHICH rows are on screen, in one band: the two search boxes, the three
            mutually-exclusive presets, then the view actions. The old layout gave search its own full-width row and then put
            Cut/Reset on the right of the preset row, opposite the presets — a left/right split that said nothing true, since both
            halves were doing the same job. The one genuinely different control (the one that writes to the database) now sits in
            row 2 instead of being grouped with them. */}
        <div className="flex flex-wrap items-center gap-2">
          {/* The search boxes are the least-touched control in a sitting — typed once, then worked against for twenty minutes —
              so they no longer stretch (flex-1) across half the panel, and the stacked labels are gone: the placeholder already
              says what each box is, and the ¬ glyph on the second is the same negation mark its committed chips carry below. */}
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={includeInputRef}
              value={includeInput}
              onChange={onIncludeInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclude(); } }}
              autoFocus
              placeholder="Include, then Enter"
              title="Narrow to rows containing this text — Enter commits it as a step, and steps stack (all must match)"
              className="w-48 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">¬</span>
            <input
              value={excludeInput}
              onChange={onExcludeInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExclude(); } }}
              placeholder="Exclude, then Enter"
              title="Drop rows containing this word — whole words only, so excluding SAND doesn't also drop SANDALS"
              className="w-48 rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* PRESETS — a segmented control, not three free-standing buttons. They are already mutually exclusive in the handlers
              (picking one clears the others); grouping them in one container makes that visible instead of leaving the operator to
              discover it. Styled identically to the rate strip in row 2 — both are "pick one", so they read as siblings — and the
              single brand fill replaces the old amber / sky / emerald trio. That mattered beyond tidiness: emerald was
              simultaneously "a filter view" here and "this writes to the database" on the send button, so one colour carried two
              very different meanings. Emerald is now reserved for the write, and nothing else on the screen wears it. */}
          <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
            <button
              type="button"
              onClick={toggleWinners}
              title="Show only SKUs with more than £30 profit in the last 30 days"
              className={
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium ' +
                (winnersOnly ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')
              }
            >
              <TrophyIcon className="h-4 w-4" />
              Winners
            </button>
            <button
              type="button"
              onClick={togglePotential}
              title="Show only SKUs under £30 profit this month that still earn more than £3 per unit"
              className={
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium ' +
                (potentialOnly ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')
              }
            >
              <SparklesIcon className="h-4 w-4" />
              Potential
            </button>
            <button
              type="button"
              onClick={toggleRecycle}
              title="Show only SKUs that sold before, but not in the last 6 months"
              className={
                'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm font-medium ' +
                (recycleOnly ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')
              }
            >
              <ClockIcon className="h-4 w-4" />
              Recycle
            </button>
          </div>

          {/* Cut + Reset — view operations on the list the controls to their left just produced, so they close this row rather than
              sitting next to the send button. Reset goes last: it's the escape hatch, and the escape hatch belongs at the end of
              the row you might need escaping from. */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={cutSelected}
              disabled={selected.size === 0}
              title="Cut every selected row — arrow to one, or click it; Shift-click to extend a range, Ctrl/Cmd-click to add one. Enter does the same."
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 disabled:opacity-40 disabled:hover:bg-white"
            >
              <XMarkIcon className="h-4 w-4" />
              Cut{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!filtering && cut.size === 0 && !anyCoverage}
              title="Clear every filter, restore cut rows, clear the coverage fill, and show the whole list"
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>

        {/* ROW 2 — FILL, then the state of what you've built, then SEND: the rest of the loop, reading left to right. The rate
            strip used to sit alone on its own divided row as if it were unrelated furniture, when it's really the second half of
            the core gesture (narrow the list in row 1, then fill what's left). The counts and chips sit in the middle on a
            reserved height, so committing or dropping a search step no longer changes the panel's height — this panel is sticky,
            so any resize shoves the whole table up or down under it. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
            {COVERAGE_OPTIONS.map((months) => (
              <button
                key={months}
                type="button"
                onClick={() => applyCoverage(months)}
                title={
                  coverageMonths === months
                    ? 'Click again to clear the Basket'
                    : `Fill Basket with what's needed to cover ${months} month${months === 1 ? '' : 's'} of sales (Sold 30d x ${months}, minus FBA Total)`
                }
                className={
                  'rounded px-2.5 py-1 text-sm font-medium ' +
                  (coverageMonths === months
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {months === 0.5 ? '½' : months}
              </button>
            ))}
          </div>

          {/* Row count and cut count. Committed search steps (includes/excludes) deliberately show no chips of their own (owner,
              2026-08-20 — "they get messy") — Reset is the one way back to an unfiltered list. */}
          <div className="flex min-h-[2.25rem] min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
            <span className="mr-1 whitespace-nowrap text-slate-500">
              {/* Cut rows drop out of visible too, so the count includes them alongside search/preset filtering — a cut shouldn't
                  leave the "Rows: X of Y" figure reading as if nothing happened (owner, 2026-08-13). */}
              {filtering || cut.size > 0 ? (
                <>Rows: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {rows.length}</span></>
              ) : (
                <><span className="font-semibold text-slate-800">{rows.length}</span><span className="text-slate-400"> SKUs</span></>
              )}
            </span>
            {cut.size > 0 && (
              <>
                <span className="text-slate-300">|</span>
                <span className="whitespace-nowrap text-slate-400">
                  {cut.size} cut
                  <button type="button" onClick={() => setCut(new Set())} className="ml-1.5 font-medium text-brand-600 hover:underline">
                    restore
                  </button>
                </span>
              </>
            )}
          </div>

          {/* BASKET ACTIONS — the two things you can do with what you've built, anchored right as a pair: throw it away, or send
              it. Clear sits LEFT of Send so the destructive one is never the button under the cursor when you reach for the one
              you actually want, and it's quiet (bordered, not filled) against Send's fill. Red here because Clear is destructive
              (empties the whole basket + discards the draft); row 1's Cut is neutral slate — cutting a row is just a view hide,
              not a delete, so it doesn't earn the same alarm colour (owner, 2026-08-24 — "too much in your face").

              items-STRETCH, not items-center: Send grows a second line once the basket has something in it, and a short Clear
              floating centred beside a tall Send read as two unrelated controls rather than the pair they are. Stretching ties
              their heights together whichever state Send is in — each child centres its own contents, so nothing else moves. */}
          <div className="ml-auto flex items-stretch gap-2">
            {!confirmingClear ? (
              <button
                type="button"
                onClick={() => { setConfirmingOrder(false); setConfirmingClear(true); }}
                disabled={ordering || orderTargets.length === 0}
                title="Empty the whole basket — every row with a value, not just the ones on screen — and discard the saved draft"
                className="flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:opacity-40 disabled:hover:bg-white"
              >
                <TrashIcon className="h-4 w-4" />
                Clear basket
              </button>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <span className="text-slate-700">
                  Clear all {orderTargets.length} SKU{orderTargets.length === 1 ? '' : 's'} from the basket?
                </span>
                <button type="button" onClick={clearBasket} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Clear</button>
                <button type="button" onClick={() => setConfirmingClear(false)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Cancel</button>
              </span>
            )}

            {/* LOAD BASKET — moved here between Clear and Send (owner, 2026-08-20): it's a basket action like its two neighbours,
                not a narrowing filter like Winners/Potential/Recycle, so it reads more clearly sitting with the other two things
                that act on the basket rather than in row 1's segmented preset control. Still the same toggle underneath
                (toggleOrdersOnly/ordersOnly), still mutually exclusive with Winners/Potential/Recycle. */}
            <button
              type="button"
              onClick={toggleOrdersOnly}
              title="Load every SKU with a number currently in Basket"
              className={
                'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ' +
                (ordersOnly
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50')
              }
            >
              <FunnelIcon className="h-4 w-4" />
              Load basket
            </button>

            {/* SEND TO ORDER STATUS — turns every positive Basket box into real orderstatus TO PLACE rows via /order-status-add, one
                unit per row, ordertype 3 (Amazon). Inline confirm (not window.confirm — see CustomerOrderList.tsx) states the total
                before it writes anything, since this is a real DB write rather than more scratchpad editing.

                The only SOLID button on the screen. Everything else is a bordered or tinted control of equal weight, which left the
                one irreversible action looking like just another view toggle; a single filled control spends the page's whole colour
                budget in the one place it's earned. The LABEL is the action, not the noun: "Basket" already names the column you
                type into and the "Load basket" preset, so using it a third time here gave the write the same word as two harmless
                things. The same verb now carries through the confirm ("Send … to Order Status?" / "Send"), the progress
                ("Sending 3/5…") and the result ("Sent 5 SKUs"). */}
            {!confirmingOrder ? (
              <button
                type="button"
                onClick={() => { setConfirmingClear(false); setConfirmingOrder(true); }}
                disabled={ordering || orderTargets.length === 0}
                title={
                  `Send every SKU with a number in Basket to the Order Status TO PLACE queue — every row with a value, not just the ones on screen. The cost shown is for on-screen rows only.` +
                  (basketCost.unpriced > 0 ? ` (+${basketCost.unpriced} unit${basketCost.unpriced === 1 ? '' : 's'} on screen with no known cost, not in the total)` : '')
                }
                className="flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-1.5 text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
              >
                <ShoppingCartIcon className="h-5 w-5" />
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-sm font-medium">
                    {ordering && orderProgress
                      ? `Sending ${orderProgress.done}/${orderProgress.total}…`
                      : 'Send to Order Status'}
                  </span>
                  {/* Second line — what's in the basket, spelled out rather than left as a bare "10/41" fraction the reader has to
                      decode. Suppressed while the button is disabled (nothing in the basket) and while a send is in flight, where
                      the progress count above is the only number that matters. */}
                  {!ordering && orderTargets.length > 0 && (
                    <span className="text-xs font-normal text-emerald-100">
                      {basketOnScreenCount} of {orderTargets.length} SKU{orderTargets.length === 1 ? '' : 's'} on screen
                      {(basketCost.total > 0 || basketCost.unpriced > 0) && ` · ${money(basketCost.total)}`}
                      {basketCost.unpriced > 0 && ` +${basketCost.unpriced} unpriced`}
                    </span>
                  )}
                </span>
              </button>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <span className="text-slate-700">
                  Send {orderTotalUnits} unit{orderTotalUnits === 1 ? '' : 's'} across {orderTargets.length} SKU{orderTargets.length === 1 ? '' : 's'} to Order Status?
                </span>
                <button type="button" onClick={submitOrder} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">Send</button>
                <button type="button" onClick={() => setConfirmingOrder(false)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Cancel</button>
              </span>
            )}
          </div>
        </div>

        {orderError && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs">
            <span className="text-red-600">{orderError}</span>
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        // No overflow of its own — see panelHeight above. Anything with overflow:auto here would become the sticky positioning
        // context again and put the second scrollbar back; the rows scroll with the page, and the header row below pins itself
        // under the panel instead.
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-max min-w-full text-sm">
            {/* Pinned under the live bottom edge of the panel rather than at top:0, which would tuck it behind. The panel is
                z-30 and this is z-10, so the two overlap in the right order during the moment a scroll is settling. */}
            <thead
              ref={headRef}
              style={{ top: panelHeight }}
              className="sticky z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"
            >
              <tr>
                {/* Order sits right after Sold (7d) — COLUMNS[0..5] is code/local_stock/fba_live/fba_total/units_30d/units_7d
                    (6 columns), then the scratchpad, then unit_profit/profit_30d. Barcode/Amazon SKU/Supplier (COLUMNS[8..10])
                    are looked up rarely enough that they're no longer columns at all — click the caret next to a SKU to reveal
                    them inline instead (see the `expanded` detail row in the body below) — so only COLUMNS.slice(6, 8) renders
                    here now. */}
                {COLUMNS.slice(0, 6).map((c) => renderColumnHeader(c, sortKey, sortDir, onSort))}
                {renderColumnHeader(
                  { key: 'order_qty', label: 'Basket', title: 'Planning scratchpad — not saved server-side, this browser only', align: 'right' },
                  sortKey, sortDir, onSort,
                )}
                {COLUMNS.slice(6, 8).map((c) => renderColumnHeader(c, sortKey, sortDir, onSort))}
                {/* Cut — no sort, just a header label for the X button column. */}
                <th className="whitespace-nowrap px-2 py-1.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r) => (
                <Fragment key={r.code}>
                <tr
                  ref={cursor.itemRef(r.code)}
                  style={{ scrollMarginTop: stickyOffset }}
                  onClick={(e) => onRowClick(e, r.code)}
                  className={
                    'group cursor-pointer select-none ' +
                    // The one highlight on the screen. A step up from the old brand-50 because it's now carrying the job the
                    // hairline cursor used to share — you have to be able to find it after looking away, not just notice it.
                    (selected.has(r.code) ? 'bg-brand-100' : 'hover:bg-slate-50')
                  }
                >
                  {/* Pinned LEFT to match the header (see renderColumnHeader). Its background can't just inherit the row's — a
                      sticky cell paints over whatever scrolls under it, so the row's hover/select fill wouldn't show through — so
                      the same two states are re-applied here explicitly, via group-hover off the <tr>'s `group` above. The left
                      rail is part of the selected look rather than a second signal of its own: it gives the blue row a hard edge
                      to find at the point the eye starts reading from. The caret button opens the detail row (see below) on its
                      own click — stopPropagation so it doesn't also fire the row's select click underneath it. */}
                  <td className={
                    'sticky left-0 z-[1] whitespace-nowrap border-l-2 py-1.5 pl-3 pr-2 font-mono text-xs text-slate-600 ' +
                    (selected.has(r.code)
                      ? 'border-brand-500 bg-brand-100'
                      : 'border-transparent bg-white group-hover:bg-slate-50')
                  }>
                    <span className="inline-flex items-center gap-1">
                      {r.code}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(r.code); }}
                        title="Barcode / Amazon SKU / supplier"
                        className="rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-500"
                      >
                        <ChevronDownIcon className={'h-3 w-3 transition-transform ' + (expanded.has(r.code) ? 'rotate-180' : '')} />
                      </button>
                    </span>
                  </td>
                  <td className={'whitespace-nowrap border-l border-slate-100 px-3 py-1.5 text-right ' + (r.local_stock === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.local_stock}</td>
                  <td className={'whitespace-nowrap px-3 py-1.5 text-right ' + (r.fba_live === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.fba_live}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">
                    {r.fba_total}
                    {/* Session-only "just queued" bump — see orderedBump above. Not a DB figure, so kept visually distinct. */}
                    {orderedBump[r.code] > 0 && <span className="ml-1 text-xs text-emerald-600">+{orderedBump[r.code]}</span>}
                  </td>
                  <td className="whitespace-nowrap border-l border-slate-100 px-3 py-1.5 text-right text-slate-700">{r.units_30d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{r.units_7d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap border-l border-slate-100 px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={setInputRef(r.code)}
                      value={orderQty[r.code] || ''}
                      onChange={(e) => setOrderQty((prev) => ({ ...prev, [r.code]: e.target.value }))}
                      onKeyDown={(e) => onEditKeyDown(e, r.code)}
                      onFocus={() => { cursor.setCursor(r.code); selectOnly(r.code); setFocusedOrderCode(r.code); }}
                      onBlur={() => setFocusedOrderCode((c) => (c === r.code ? null : c))}
                      inputMode="numeric"
                      style={{ scrollMarginTop: stickyOffset }}
                      disabled={isBirkenstock(r)}
                      placeholder="—"
                      title={isBirkenstock(r) ? 'Birkenstock is ordered separately, in bulk — not from this screen' : undefined}
                      className={
                        'w-16 rounded-md border px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 ' +
                        (isBirkenstock(r)
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                          : 'border-slate-200 focus:border-brand-500 focus:ring-brand-500')
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap border-l border-slate-100 px-3 py-1.5 text-right text-slate-700">{money(r.unit_profit)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-slate-800">{money(r.profit_30d)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCut(r.code); }}
                      title="Cut from list (Reset or the restore link brings it back)"
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {/* Detail row — barcode/Amazon SKU/supplier, toggled by the caret next to the SKU above (see toggleExpanded). Not a
                    real column anymore (rarely needed, and was most of why the table needed side-scrolling); colSpan covers every
                    column: 6 (code..units_7d) + 1 (Order) + 2 (unit_profit, profit_30d) + 1 (Cut) = 10. Each value gets its own
                    CopyButton (same component/pattern as the style drill-down's groupid) rather than making the whole line
                    clickable — a bare click target you can't see the boundary of invites mis-clicks on a line with three values. */}
                {expanded.has(r.code) && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={10} className="px-3 py-2">
                      <div className="flex flex-wrap gap-x-6 gap-y-1 pl-3 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-0.5">
                          Barcode: <span className="font-mono text-slate-800">{r.barcode || '—'}</span>
                          {r.barcode && <CopyButton value={r.barcode} label="barcode" />}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          Amazon SKU: <span className="font-mono text-slate-800">{r.amz_sku || '—'}</span>
                          {r.amz_sku && <CopyButton value={r.amz_sku} label="Amazon SKU" />}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          Supplier: <span className="text-slate-800">{r.supplier || '—'}</span>
                          {r.supplier && <CopyButton value={r.supplier} label="supplier" />}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && rows.length > 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              {filtered.length === 0 ? 'Nothing found.' : 'Every matching SKU is cut.'}
              {cut.size > 0 && (
                <> <button type="button" onClick={() => setCut(new Set())} className="text-brand-600 underline">Restore</button> to bring {cut.size === 1 ? 'it' : 'them'} back.</>
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
