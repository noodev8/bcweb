'use client';
/*
=======================================================================================================================================
Page: /amazon-order  (Amazon Order module home)
=======================================================================================================================================
Purpose: Landing screen — every managed Amazon SKU with its Amazon profit (skumap.amzprofit, per unit) and profit over the last 30
         days (unit_profit x amzfeed.amzsold), best performers first. Single GET on mount via useApiQuery; the whole ~520-row set is
         fetched once and searched CLIENT-SIDE with no round-trip, same idea as /inventory.

SEARCH: two boxes, Include / Does not contain. Enter (or the Add button) commits whatever is typed as a STEP — a removable chip —
        rather than filtering live on every keystroke, so multiple narrowings stack ("ives" then "black" = ives styles, excluding
        black). All Include steps must match (ANDed substrings); no Exclude step may match. Exclude matches WHOLE WORDS ONLY via a
        \b...\b boundary — a plain substring would let excluding a colour like "SAND" also drop anything containing "SANDALS" (the
        exact footgun /inventory's filter hit and fixed, 2026-07-23; same fix reused here).

SORT: every column header is clickable. Same click-to-reverse gesture as /inventory: picking a new column adopts its default
      direction (numeric columns start high-to-low, text starts A-Z), clicking the active column again flips it. Client-side, like
      the filter — the whole list is already in memory.

CURSOR + CUT: clicking a row (or arrowing with Up/Down) sets the shared useListCursor highlight — the same "where was I" gesture
      /inventory uses. Enter, or the row's own X, CUTS it — a view-only hide (not a delete), same idea as Inventory's Cut. Cut rows
      drop out of the keyboard list too, so arrowing never lands on one. Reset restores every cut row, same as it clears the search.

      useListCursor deliberately leaves a focused INPUT alone (arrows move its caret, not the list — the hook's normal, correct
      behaviour everywhere else). The Order box is the one place that's wrong: it's a column of numbers down the row axis, so
      Up/Down should walk rows exactly like it does on the row itself. It gets its own onKeyDown that intercepts ONLY
      ArrowUp/ArrowDown, moves the shared cursor, and refocuses the box on the new row — typing, Tab, and every other key still
      belong to the input untouched.

MULTI-SELECT + BULK CUT: a SEPARATE `selected` Set from the single-row cursor above — the cursor is "where the keyboard is", the
      selection is "what a bulk action would hit", and they can disagree (arrowing around doesn't touch the selection). Plain click
      selects just that row and drops an anchor; Shift-click extends the CONTIGUOUS range from that anchor to the clicked row (in
      current view order); Ctrl/Cmd-click toggles one row in or out without disturbing the rest. The "Cut (n)" button in the filter
      bar cuts everything selected in one go. A row's own X and Enter (via useListCursor's onEnter) are unchanged — a quick single
      cut that ignores the selection entirely, so a stray click elsewhere never turns into an accidental bulk cut.

COVERAGE FILL: one-click auto-fill, see applyCoverage for the exact numbers. Targets every row CURRENTLY ON SCREEN (`visible`),
      ranks what it just filled and sorts the table to it (via the shared `manualOrder`), and is cleared by Reset. Fills Order
      (what to buy from the supplier).

SEND TO ORDER STATUS: the "Order (n)" button turns the Order scratchpad into real rows — loops POST /order-status-add per SKU (the
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

LOAD ORDER: a third quick preset, alongside Winners/Potential but independent of them (combinable with either) — show only rows
      with a positive number currently in Order, for reviewing what's been built up across the ~520-row set (owner, 2026-08-11). A
      LIVE filter, not a snapshot: re-evaluates as orderQty changes, so typing a value while it's on brings the row straight in
      without a re-toggle. The row currently FOCUSED is always exempt from this filter regardless of what it reads (focusedOrderCode)
      — otherwise backspacing a value down through 0 on the way to clearing it would yank the row, and the input being typed into,
      out of the list mid-edit.
=======================================================================================================================================
*/

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon, ChevronUpIcon, ChevronDownIcon, TrophyIcon, SparklesIcon, ShoppingCartIcon,
  FunnelIcon,
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

// The four coverage-fill presets — see applyCoverage in the component for what clicking one does.
const COVERAGE_OPTIONS = [0.5, 1, 2, 3] as const;

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
  return (
    <th
      key={c.key}
      title={c.title}
      onClick={() => onSort(c.key)}
      className={
        `cursor-pointer select-none whitespace-nowrap ${pad} py-1.5 font-medium hover:text-slate-700 ${stickyCode} ` +
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

  function addInclude() {
    const t = includeInput.trim();
    if (t && !includes.includes(t)) setIncludes((prev) => [...prev, t]);
    setIncludeInput('');
  }
  function addExclude() {
    const t = excludeInput.trim();
    if (t && !excludes.includes(t)) setExcludes((prev) => [...prev, t]);
    setExcludeInput('');
  }
  // Filter boxes are forced upper-case as typed (owner request, 2026-08-13) — purely cosmetic, since haystack()/escapeRegExp()
  // already lowercase both sides before matching.
  function onIncludeInputChange(e: React.ChangeEvent<HTMLInputElement>) { setIncludeInput(e.target.value.toUpperCase()); }
  function onExcludeInputChange(e: React.ChangeEvent<HTMLInputElement>) { setExcludeInput(e.target.value.toUpperCase()); }
  function removeInclude(t: string) { setIncludes((prev) => prev.filter((x) => x !== t)); }
  function removeExclude(t: string) { setExcludes((prev) => prev.filter((x) => x !== t)); }

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
  // Switching Winners/Potential also clears the rate-fill highlight (coverageMonths) — it was computed against whatever rows were
  // ON SCREEN at fill time (applyCoverage below), so it stops meaning anything the moment the visible set changes underneath it;
  // left lit, it read as "still applied" when it wasn't (owner, 2026-08-20). Deliberately leaves orderQty itself alone — a
  // filter is a view change, not a "wipe what I've built up" action, same reasoning as onReset above.
  function toggleWinners() { setWinnersOnly((v) => !v); setPotentialOnly(false); setCoverageMonths(null); }
  function togglePotential() { setPotentialOnly((v) => !v); setWinnersOnly(false); setCoverageMonths(null); }

  // ORDERS ONLY — a third quick preset, independent of Winners/Potential (can be combined with either): show only rows with a
  // positive number currently sitting in the Order box. A live filter, not a snapshot — re-evaluates as orderQty changes, so typing
  // a value while it's on doesn't require re-toggling to bring the row in. Order scratchpad values, keyed by code — declared here
  // (ahead of `filtered`/`sorted` below, which both need it) rather than down with the rest of the Order UI state further down.
  const [orderQty, setOrderQty] = useState<Record<string, string>>({});
  const [ordersOnly, setOrdersOnly] = useState(false);
  function toggleOrdersOnly() { setOrdersOnly((v) => !v); }
  // The row currently focused in an Order box is EXEMPT from the Orders-only filter below, regardless of what it currently reads —
  // otherwise backspacing a value down through 0 on the way to clearing it yanks the row (and the input you're typing into) out of
  // the list mid-edit, since the filter re-evaluates on every keystroke (owner, 2026-08-11 — "won't let me backspace to clear").
  const [focusedOrderCode, setFocusedOrderCode] = useState<string | null>(null);

  // Reset — clears every applied filter (and whatever's mid-typed in the box), restores every cut row, drops the selection, and
  // clears the sort/highlight the coverage fill applied. Deliberately does NOT touch the Order scratchpad itself (owner,
  // 2026-08-11) — that's a separately-saved draft (DRAFT_KEY) an operator can build up over several sittings, and Reset is a view
  // reset, not a "start the order over" action. To clear the scratchpad, re-tap the active rate button (applyCoverage below
  // already wipes and refills it from scratch on every click, owner 2026-08-20 — no separate "clear order" action needed).
  function onReset() {
    setIncludes([]); setExcludes([]); setIncludeInput(''); setExcludeInput('');
    setWinnersOnly(false); setPotentialOnly(false); setOrdersOnly(false);
    setCut(new Set()); setSelected(new Set());
    setCoverageMonths(null);
    setManualOrder(null);
    setConfirmingOrder(false); setOrderResult(null); setOrderError(null); setOrderedBump({});
    includeInputRef.current?.focus();
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (includes.length > 0 || excludes.length > 0) {
      const incTerms = includes.map((t) => t.toLowerCase());
      const excRes = excludes.map((t) => new RegExp(`\\b${escapeRegExp(t.toLowerCase())}\\b`));
      out = out.filter((r) => {
        const hay = haystack(r);
        if (incTerms.some((t) => !hay.includes(t))) return false;
        if (excRes.some((re) => re.test(hay))) return false;
        return true;
      });
    }
    if (winnersOnly) out = out.filter((r) => r.profit_30d !== null && r.profit_30d > 30);
    if (potentialOnly) {
      // Potential Winners also requires a genuinely recent sale (owner, 2026-08-20) — unit_profit is STICKY (see isRecentlySold
      // above), so without this a SKU that sold once over a year ago and never since could still pass the >£3 margin test on a
      // stale figure.
      const cutoffMs = Date.now() - SIX_MONTHS_MS;
      out = out.filter((r) => r.profit_30d !== null && r.profit_30d < 30 && r.unit_profit !== null && r.unit_profit > 3 && isRecentlySold(r, cutoffMs));
    }
    if (ordersOnly) out = out.filter((r) => r.code === focusedOrderCode || (Number(orderQty[r.code]) || 0) > 0);
    return out;
  }, [rows, includes, excludes, winnersOnly, potentialOnly, ordersOnly, orderQty, focusedOrderCode]);

  const filtering = includes.length > 0 || excludes.length > 0 || winnersOnly || potentialOnly || ordersOnly;

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
  const [orderResult, setOrderResult] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  // Session-only running total of what's just been queued per SKU, added on top of fba_total for display — an immediate "yes it
  // went in" signal while submitOrder's refresh() (below) is still in flight. fba_total itself now counts not-yet-arrived Amazon
  // orderstatus lines server-side (owner, 2026-08-13 — "otherwise we may double order"), so once that refresh lands the real
  // number already includes what was just queued and the bump is cleared to avoid double-counting on screen.
  const [orderedBump, setOrderedBump] = useState<Record<string, number>>({});

  async function submitOrder() {
    setConfirmingOrder(false);
    if (orderTargets.length === 0) return;
    setOrdering(true); setOrderError(null); setOrderResult(null);
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
    setOrderResult(`Queued ${queued} SKU${queued === 1 ? '' : 's'} to Order Status`);
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
  // declaration (it assumes the value may still be mutated), and the bail-out cascades into visibleOrderCost and cursorKeys.
  const [cut, setCut] = useState<Set<string>>(new Set());
  const visible = useMemo(() => sorted.filter((r) => !cut.has(r.code)), [sorted, cut]);

  // COVERAGE FILL — the 0.5/1/2/3 month buttons. units_30d is already a fixed-window monthly rate (amzfeed.amzsold — see the route
  // header), so demand for N months is simply units_30d * N. What we'd actually need to ORDER is that demand minus fba_total (live
  // + inbound — stock already at or on its way to Amazon). local_stock itself is still deliberately EXCLUDED from "on hand" — it
  // doesn't satisfy Amazon demand until picked, and there's no pick mechanism on this screen right now (pulled 2026-08-11, revisit
  // later). A SKU with nothing to order (already covered, or a loss-maker — isLoss, below) is left OUT of the fill entirely rather
  // than written as 0 — its box is simply left out of the fill. Fills every row CURRENTLY ON SCREEN (`visible`: after search +
  // Winners/Potential + cut), so filtering down first and then clicking a button targets exactly that working set. Clicking the
  // ALREADY-ACTIVE rate button is the clear gesture (owner, 2026-08-20) — it toggles off, wiping the Order scratchpad (and its
  // saved browser draft) back to empty instead of recomputing the same fill. Clicking a DIFFERENT rate wipes and refills from
  // scratch, so a rate click always reflects one clean calculation rather than layering onto whatever was typed or filled before
  // (owner, 2026-08-13). Also sets `manualOrder` to the just-filled rows ranked biggest-need-first, so the table sorts to show
  // what was just added without the operator having to click the Order column (which isn't even a sortable header) — see the
  // `sorted` memo above.
  const [coverageMonths, setCoverageMonths] = useState<number | null>(null);
  function applyCoverage(months: number) {
    if (coverageMonths === months) {
      setCoverageMonths(null);
      setOrderQty({});
      setManualOrder(null);
      return;
    }
    setCoverageMonths(months);
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
    const next: Record<string, string> = {};
    filled.forEach(({ code, qty }) => { next[code] = String(qty); });
    setOrderQty(next);
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

  // ON-SCREEN ORDER COST — total spend of the proposed Order, restricted to rows CURRENTLY VISIBLE (unlike orderTargets above,
  // which deliberately reaches off-screen so nothing typed before a filter/cut is silently dropped from the real submission). This
  // is a display-only running total, scoped to what the operator is looking at right now. cost = skusummary.cost (CLAUDE.md: never
  // skumap.cost) — some SKUs carry no numeric cost, so those units are flagged as unpriced rather than silently treated as free.
  const visibleOrderCost = useMemo(() => {
    let total = 0;
    let unpriced = 0;
    for (const r of visible) {
      if (isBirkenstock(r)) continue;
      const qty = Math.floor(Number(orderQty[r.code]));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (r.cost === null) { unpriced += qty; continue; }
      total += qty * r.cost;
    }
    return { total, unpriced };
  }, [visible, orderQty]);

  // Keyboard cursor over the visible rows — click a row (or arrow Up/Down) to move the highlight, Enter cuts the current row. Keys
  // are the VISIBLE rows only, so a cut row can never be the cursor's target and arrowing always lands on something on screen.
  const cursorKeys = useMemo(() => visible.map((r) => r.code), [visible]);
  const cursor = useListCursor({
    keys: cursorKeys,
    enabled: !loading && !error,
    onEnter: onCut,
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
  function cutSelected() {
    if (selected.size === 0) return;
    setCut((prev) => {
      const next = new Set(prev);
      selected.forEach((c) => next.add(c));
      return next;
    });
    clearOrderQtyFor(selected);
    setSelected(new Set());
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
    const nextInput = inputRefs.current.get(nextCode);
    nextInput?.focus();
    nextInput?.select();
  }

  return (
    <AppShell title="Amazon Order" backHref="/dashboard" backLabel="Dashboard">
      {/* Search bar — Enter commits the box as a step; steps stack and AND together. Sticky (not just the table header below) so
          the filters, presets, and the Order/Cut buttons never scroll out of reach while working down a long list — the table
          itself now scrolls in its OWN bounded region (see the container below), so this only matters on short viewports where
          the page still scrolls, but it's a cheap safety net either way (owner request, 2026-08-13 — "too much scrolling"). */}
      <div className="sticky top-0 z-30 mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Include</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={includeInputRef}
                value={includeInput}
                onChange={onIncludeInputChange}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInclude(); } }}
                autoFocus
                placeholder="e.g. ives, then Enter"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={excludeInput}
              onChange={onExcludeInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExclude(); } }}
              placeholder="e.g. black, then Enter"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        {/* Action row — presets, bulk cut, coverage fill, reset. Its own row under the search boxes so it doesn't crowd them. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleWinners}
            title="Show only SKUs with more than £30 profit in the last 30 days"
            className={
              'flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium ' +
              (winnersOnly
                ? 'border-amber-500 bg-amber-50 text-amber-700'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50')
            }
          >
            <TrophyIcon className="h-4 w-4" />
            Winners
          </button>
          <button
            type="button"
            onClick={togglePotential}
            title="Show only SKUs under £30 profit this month that still earn more than £3 per unit — the margin's there, it just hasn't sold enough yet"
            className={
              'flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium ' +
              (potentialOnly
                ? 'border-sky-500 bg-sky-50 text-sky-700'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50')
            }
          >
            <SparklesIcon className="h-4 w-4" />
            Potential
          </button>
          <button
            type="button"
            onClick={toggleOrdersOnly}
            title="Load only SKUs with a number currently in Order — combines with Winners/Potential"
            className={
              'flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm font-medium ' +
              (ordersOnly
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50')
            }
          >
            <FunnelIcon className="h-4 w-4" />
            Load order
          </button>

          {/* Cut + Reset — pushed to the right (ml-auto), apart from the presets on the left. */}
          <div className="ml-auto flex items-center gap-2">
            {/* SEND TO ORDER STATUS — turns every positive Order box into real orderstatus TO PLACE rows via /order-status-add, one
                unit per row, ordertype 3 (Amazon). Inline confirm (not window.confirm — see CustomerOrderList.tsx) states the total
                before it writes anything, since this is a real DB write rather than more scratchpad editing. */}
            {!confirmingOrder ? (
              <button
                type="button"
                onClick={() => setConfirmingOrder(true)}
                disabled={ordering || orderTargets.length === 0}
                title="Send every SKU with a number in Order to the Order Status TO PLACE queue"
                className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-white disabled:text-slate-400"
              >
                <ShoppingCartIcon className="h-4 w-4" />
                {ordering && orderProgress ? `Queuing ${orderProgress.done}/${orderProgress.total}…` : `Order (${orderTargets.length})`}
              </button>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <span className="text-slate-700">
                  Queue {orderTotalUnits} unit{orderTotalUnits === 1 ? '' : 's'} across {orderTargets.length} SKU{orderTargets.length === 1 ? '' : 's'}?
                </span>
                <button type="button" onClick={submitOrder} className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">Yes</button>
                <button type="button" onClick={() => setConfirmingOrder(false)} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">No</button>
              </span>
            )}
            <button
              type="button"
              onClick={cutSelected}
              disabled={selected.size === 0}
              title="Cut every selected row (click a row, Shift-click to extend a range, Ctrl/Cmd-click to add one)"
              className="flex items-center gap-1.5 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:opacity-40 disabled:hover:bg-white"
            >
              <XMarkIcon className="h-4 w-4" />
              Cut{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={!filtering && cut.size === 0 && coverageMonths === null}
              title="Clear every filter, restore cut rows, clear the coverage fill, and show the whole list"
              className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
            >
              <ArrowPathIcon className="h-4 w-4" />
              Reset
            </button>
          </div>
        </div>

        {/* Coverage fill — its own row, separate from the presets above (owner, 2026-08-19: "the row feels cluttered" once Sold in
            6mo joined Winners/Potential/Load order). Writes the Order box for every row ON SCREEN (filter down first, then click
            a rate) — see applyCoverage. */}
        <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
          <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-white p-1">
            {COVERAGE_OPTIONS.map((months) => (
              <button
                key={months}
                type="button"
                onClick={() => applyCoverage(months)}
                title={
                  coverageMonths === months
                    ? 'Click again to clear the Order scratchpad'
                    : `Fill Order with what's needed to cover ${months} month${months === 1 ? '' : 's'} of sales (Sold 30d x ${months}, minus FBA Total)`
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
        </div>

        {/* Chips for each committed step, plus the row count. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            {/* Cut rows drop out of visible too, so the count includes them alongside search/preset filtering — a cut shouldn't
                leave the "Rows: X of Y" figure reading as if nothing happened (owner, 2026-08-13). */}
            {filtering || cut.size > 0 ? (
              <>Rows: <span className="font-semibold text-slate-800">{visible.length}</span><span className="text-slate-400"> of {rows.length}</span></>
            ) : (
              <><span className="font-semibold text-slate-800">{rows.length}</span><span className="text-slate-400"> SKUs</span></>
            )}
          </span>
          {/* ON-SCREEN ORDER COST — see visibleOrderCost above: total cost of the proposed Order, rows currently visible only. */}
          {(visibleOrderCost.total > 0 || visibleOrderCost.unpriced > 0) && (
            <>
              <span className="text-slate-300">|</span>
              <span
                className="whitespace-nowrap text-slate-500"
                title="Total skusummary.cost x Order qty, for rows currently on screen only (filters/cuts change this)"
              >
                Order cost: <span className="font-semibold text-slate-800">{money(visibleOrderCost.total)}</span>
                {visibleOrderCost.unpriced > 0 && (
                  <span className="ml-1 text-amber-600" title={`${visibleOrderCost.unpriced} unit${visibleOrderCost.unpriced === 1 ? '' : 's'} with no known cost — not included in the total`}>
                    (+{visibleOrderCost.unpriced} unpriced)
                  </span>
                )}
              </span>
            </>
          )}
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
          {includes.map((t) => (
            <span key={`inc-${t}`} className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
              {t}
              <button type="button" onClick={() => removeInclude(t)} className="ml-0.5 rounded text-brand-400 hover:text-brand-700">
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          {excludes.map((t) => (
            <span key={`exc-${t}`} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
              <span className="no-underline">¬</span>{t}
              <button type="button" onClick={() => removeExclude(t)} className="ml-0.5 rounded text-slate-400 hover:text-slate-700">
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>

        {(orderResult || orderError) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs">
            {orderResult && <span className="font-medium text-emerald-700">{orderResult}</span>}
            {orderError && <span className="text-red-600">{orderError}</span>}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        // Bounded height + its own scrollbar (both axes) — with ~520 rows the table used to make the WHOLE PAGE scroll, so
        // getting from a row back to the toolbar/header meant a long scroll up. Scoping the scroll to this box instead keeps the
        // toolbar and (via the sticky thead below) the column headers permanently in view; only the rows themselves scroll
        // (owner request, 2026-08-13 — "too much scrolling up and down"). The offset accounts for AppShell's header+nav+title
        // plus the toolbar above.
        <div className="max-h-[calc(100vh-21rem)] min-h-[16rem] overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-max min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {/* Order sits right after Sold (7d) — COLUMNS[0..5] is code/local_stock/fba_live/fba_total/units_30d/units_7d
                    (6 columns), then the scratchpad, then unit_profit/profit_30d. Barcode/Amazon SKU/Supplier (COLUMNS[8..10])
                    are looked up rarely enough that they're no longer columns at all — click the caret next to a SKU to reveal
                    them inline instead (see the `expanded` detail row in the body below) — so only COLUMNS.slice(6, 8) renders
                    here now. */}
                {COLUMNS.slice(0, 6).map((c) => renderColumnHeader(c, sortKey, sortDir, onSort))}
                {renderColumnHeader(
                  { key: 'order_qty', label: 'Order', title: 'Planning scratchpad — not saved server-side, this browser only', align: 'right' },
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
                  onClick={(e) => onRowClick(e, r.code)}
                  className={
                    'group cursor-pointer select-none ' +
                    (selected.has(r.code) ? 'bg-brand-50' : 'hover:bg-slate-50')
                  }
                >
                  {/* Cursor (keyboard position) gets its own left accent, independent of the selection fill above — the two can
                      disagree (arrowing around doesn't touch what a bulk Cut would hit), so they need visually distinct signals.
                      Also pinned LEFT to match the header (see renderColumnHeader) — its background can't just inherit the row's
                      (a sticky cell paints over whatever scrolls under it, so the row's hover/select fill wouldn't show through),
                      so it's re-applied here explicitly via group-hover off the <tr>'s `group` above. The caret button opens the
                      detail row (see below) on its own click — stopPropagation so it doesn't also fire the row's select/cursor
                      click underneath it. */}
                  <td className={
                    'sticky left-0 z-[1] whitespace-nowrap py-1.5 pl-3 pr-2 font-mono text-xs text-slate-600 border-l-2 ' +
                    (cursor.isCursor(r.code) ? 'border-brand-500 ' : 'border-transparent ') +
                    (selected.has(r.code) ? 'bg-brand-50' : 'bg-white group-hover:bg-slate-50')
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
                  <td className={'whitespace-nowrap px-3 py-1.5 text-right ' + (r.local_stock === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.local_stock}</td>
                  <td className={'whitespace-nowrap px-3 py-1.5 text-right ' + (r.fba_live === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.fba_live}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">
                    {r.fba_total}
                    {/* Session-only "just queued" bump — see orderedBump above. Not a DB figure, so kept visually distinct. */}
                    {orderedBump[r.code] > 0 && <span className="ml-1 text-xs text-emerald-600">+{orderedBump[r.code]}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{r.units_30d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{r.units_7d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={setInputRef(r.code)}
                      value={orderQty[r.code] || ''}
                      onChange={(e) => setOrderQty((prev) => ({ ...prev, [r.code]: e.target.value }))}
                      onKeyDown={(e) => onEditKeyDown(e, r.code)}
                      onFocus={() => { cursor.setCursor(r.code); setFocusedOrderCode(r.code); }}
                      onBlur={() => setFocusedOrderCode((c) => (c === r.code ? null : c))}
                      inputMode="numeric"
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
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{money(r.unit_profit)}</td>
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
              {filtered.length === 0 ? 'No SKUs match.' : 'Every matching SKU is cut.'}
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
