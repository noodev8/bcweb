'use client';
/*
=======================================================================================================================================
Page: /analytics/sales  (Analytics module — Sales)
=======================================================================================================================================
Purpose: The sales ledger an analyst opens to answer "how are we doing?" — recent sale lines with the PROFIT already computed downstream,
         under a headline strip whose hero is NET PROFIT (with revenue, margin and net units sold supporting; there is no Orders tile —
         on this catalogue an order is nearly always one pair, so it just restated units). The reframed successor to the legacy
         PowerBuilder "Sales" screen: windowed (Today / Yesterday / 7·30·90d / custom), channel-filtered (All / Shopify / Amazon), and
         searchable to a single product. Returns are shown (as red negative-profit lines) and netted into the totals — a sales/profit view
         has to tell the truth about refunds, unlike the velocity-only pricing module.

         SEARCH is the Inventory screen's proven filter, ported here (owner, 2026-07-25): two boxes — Contains / Does not contain — and a
         Find that COMMITS the term as a step, each one narrowing the last ("ARIZONA" -> not "EVA" -> "BLACK"). The old single box
         debounced and re-queried on every keystroke; this doesn't fire until you ask it to.

         Every step is applied SERVER-side, which is the one thing that matters here and the one place this differs from Inventory.
         Inventory can narrow in the browser because it holds the entire style list in memory; this screen only ever holds the capped page
         of lines (200 in product mode) out of a possibly-thousand-line match. Filtering that page client-side would narrow a SAMPLE, and
         a headline recomputed from it would be a partial number under an honest-looking label — on the one screen whose whole point is
         net profit. So `steps` go to the API and the summary strip stays the server's uncapped aggregate over the fully-narrowed set.
         (The scan is ~28ms on a 17.7k-row table, so there is nothing to save by doing it here.)

         A Contains step flips the screen into product mode (last 12 months). A Does-not-contain step on its own does NOT — it just
         narrows the window you're already on ("today's sales, excluding EVA").

         START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST — Inventory's rule, ported (owner, 2026-07-27 there, 2026-07-30 here).
         Steps only ever shrink the set, but the box is also how you start a NEW hunt ("ARIZONA" … then "IVES"), and stacked on the old
         steps that can only find nothing. So a merged filter that comes back empty is re-run with the NEWEST Find's terms alone and
         that is what's shown, silently — the breadcrumb already shows what's in force. If that is empty too, the screen says there are
         no sales. See the fetcher for the 3-char departure from Inventory, and for why the retry isn't in an effect.

         Export CSV builds from the loaded rows (the current filtered view) so the analyst can carry it into Excel. Row click reuses the
         cross-module ProductActions chooser (reprice / copy), same as Price Changes.

         UPDATE ORDERS (2026-07-28) sits at the right-hand end of the filter row — deliberately quiet, and deliberately NOT its own
         row. This screen is where you notice today's sales look thin, so this is where the "is that real, or has the update not run?"
         button belongs. It runs the whole Shopify order pipeline (orders -> orderstatus, sales booked, shipped orders archived, picks
         allocated, housekeeping) in one server-side transaction. The same control is on Customer Orders; both render the shared
         components/UpdateOrdersButton.tsx, whose header explains the two call sites and the label-vs-route naming.

         !! THAT PIPELINE ALSO RUNS FROM CRON as C:\scripts\orders\update_orders.py — two implementations of one business process,
            both live. Before changing what a run does, read the banner at the top of bcweb-server/utils/orderSync.js. !!

Guarded by AppShell. Consumes GET /analytics-sales, POST /order-sync, GET /order-sync-last.
=======================================================================================================================================
*/

import { useCallback, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CheckBadgeIcon, MagnifyingGlassIcon, ArrowPathIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import UpdateOrdersButton from '@/components/UpdateOrdersButton';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getSalesReport,
  SalesFilterStep, SalesReportData, SalesReportRow, SalesReportSummary, SalesSort, SalesSortDir, SalesWindow,
} from '@/lib/api';

// What the screen actually renders: the API payload, plus which steps produced it. The two can differ — see START FRESH below. Every part of
// the UI that talks about "the current filter" (the chips, the next Find, the empty state) reads `usedSteps`, never the raw `steps`
// state, so the screen can never describe itself with a filter that isn't the one on display.
type SalesView = SalesReportData & { usedSteps: SalesFilterStep[] };

type ChannelFilter = 'all' | 'shp' | 'amz';

const CHANNEL_TABS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
];

// Two tiers of window. SHORT windows carry the line list (the daily-trade pulse). LONG windows are summary-only — totals over a longer
// horizon with no list (a 30-90d list would be thousands of rows). They're shown as a separate group, labelled "totals", so the different
// behaviour is signalled before you click.
const SHORT_WINDOW_TABS: { key: SalesWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '3d', label: '3 days' },
];
const LONG_WINDOW_TABS: { key: SalesWindow; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
];

// Per-channel chip identity (compact — this is a dense table). Tints match the rest of the module (Shopify=emerald, Amazon=amber).
const CHANNEL_CHIP: Record<string, { label: string; cls: string }> = {
  SHP: { label: 'Shopify', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  AMZ: { label: 'Amazon', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  CM3: { label: 'CM3', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

// Stable identity for "no rows yet" — a fresh [] each render would defeat the memos that derive from it.
const NO_ROWS: SalesReportRow[] = [];

export default function SalesPage() {
  const pathname = usePathname();

  // Direct, column-aware click behaviour (replaces the shared reprice/copy chooser on this page). The operator told us: don't ask —
  //   • click the Product cell  -> copy the groupid
  //   • click the Order cell     -> copy the order number
  //   • click anything else      -> jump straight to the row's OWN channel pricing page (Shopify rows -> Shopify, Amazon rows -> Amazon).
  //     A row that isn't Shopify or Amazon (e.g. CM3) has no pricing page here, so a click on it does nothing.
  // Price pages open in a NEW TAB and carry ?from=<here> so their "← Back" returns to this ledger (same behaviour the old chooser had).
  const rowAction = useCallback((r: SalesReportRow) => {
    const from = encodeURIComponent(pathname || '/');
    if (r.channel === 'SHP' && r.groupid) {
      window.open(`/pricing/style/${encodeURIComponent(r.groupid)}?from=${from}`, '_blank', 'noopener');
    } else if (r.channel === 'AMZ') {
      // SKU-grain: an Amazon row carries its exact code -> deep-link to that size's drill; fall back to a pre-search by groupid.
      const url = r.code
        ? `/amz/sku/${encodeURIComponent(r.code)}?from=${from}`
        : `/amz/find?q=${encodeURIComponent(r.groupid || '')}&from=${from}`;
      window.open(url, '_blank', 'noopener');
    }
    // else: not a priceable channel here — stay put.
  }, [pathname]);

  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [win, setWin] = useState<SalesWindow>('today');

  // Column sort (owner, 2026-08-03). Two columns only — When and Product — which is what was asked for, and they're the two you
  // actually re-order a ledger by ("show me these grouped by style", "walk it forwards from the oldest"). Default is the ledger's
  // long-standing newest-first.
  //
  // It goes to the SERVER, not Array.prototype.sort, because this page holds at most `limit` rows out of the matched set: sorting the
  // loaded page ascending would show the oldest of the LATEST 200 while the header claimed "oldest first". See routes/analytics-sales.js.
  // Being in the SWR key below is what makes a header click re-query — there is no separate "go fetch" call, same as the steps.
  const [sort, setSort] = useState<SalesSort>('date');
  const [dir, setDir] = useState<SalesSortDir>('desc');
  // Click the sorted column to flip direction; click a different one to sort by it, starting descending (newest / Z-A) because that is
  // where each column already sat and a click shouldn't jump the list to somewhere unrelated before you've asked it to.
  const onSort = useCallback((col: SalesSort) => {
    setDir((d) => (sort === col ? (d === 'desc' ? 'asc' : 'desc') : 'desc'));
    setSort(col);
  }, [sort]);

  // The two boxes, and the ordered steps committed so far (same model as Inventory). Steps are display-only here too: to drop one, Reset.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<SalesFilterStep[]>([]);
  // The terms committed by the MOST RECENT Find, kept apart from the merged list because the start-fresh rule below has to be able to
  // re-run them on their own. Inventory doesn't need this — it rebuilds the criteria inside its own handler — but here the retry happens
  // in the fetcher, which only ever sees the merged `steps`.
  const [lastFind, setLastFind] = useState<SalesFilterStep[]>([]);
  const [hint, setHint] = useState<string | null>(null);  // inline "why nothing happened" note on a rejected Find
  const containsRef = useRef<HTMLInputElement>(null);     // Reset / Find hand focus back here for the next term

  // The key carries channel + window + every committed step, so committing a Find (or Reset) IS the re-query — there is no separate
  // "now go fetch" call. `steps` is an array of objects; SWR hashes it structurally, so a new array with equal contents won't refetch.
  //
  // START FRESH WHEN THE NARROWING WOULD EMPTY THE LIST — the same rule the Inventory screen already runs (owner, 2026-07-27; see
  // src/app/inventory/page.tsx onFind). Each Find normally narrows what's on screen, but the operator often uses the box to start a NEW
  // hunt ("ARIZONA" … then "IVES"), and stacked on the old steps that can only ever find nothing. So when the merged filter comes back
  // empty we re-run the terms from THIS Find alone, dropping everything before them, and show that.
  //
  // Keeping the newest terms, not the opening one, is the whole point: the operator has just told us what they now want to look at. An
  // earlier cut of this kept the FIRST Contains instead, which answered a question nobody had asked any more — type ARIZONA then IVES
  // and you got Arizonas back (owner, 2026-07-30).
  //
  // The one place this departs from Inventory is the 3-CHAR FLOOR. Inventory filters in memory with no minimum, but here the server
  // ignores a leading Contains under 3 chars, so starting fresh on a short narrowing term ("38") would drop the filter entirely and
  // return the whole window — the exact opposite of narrowing. Those retries are skipped and the empty state stands instead.
  //
  // Never fires in summary-only mode: a long window returns no lines BY DESIGN, so there is no empty result to rescue.
  //
  // It lives in the FETCHER, not an effect: the retry exists only as the continuation of the first request, `steps` stays the cache key,
  // and there is no setState-in-effect (docs/maintenance-notes.md — no data fetching in effects, anywhere). Inventory probes before it
  // applies so the dead intermediate state never paints; the same holds here, because both requests resolve before SWR publishes.
  const { data, error: loadError, busy: loading, refresh } = useApiQuery<SalesView>(
    ['sales-report', channel, win, steps, lastFind, sort, dir],
    async () => {
      const res = await getSalesReport({ channel, window: win, steps, sort, dir });
      if (!res.success || !res.data) return res as { success: false; error?: string; return_code?: string };

      // Viable on its own = either no Contains at all, or one the server won't reject for being too short.
      const freshLead = lastFind.find((s) => s.op === 'has');
      const freshViable = lastFind.length > 0 && (!freshLead || freshLead.term.length >= 3);
      const startFresh =
        res.data.rows.length === 0 && !res.data.summaryOnly && freshViable && lastFind.length < steps.length;

      // Adopt the fresh result WHETHER OR NOT it found anything — Inventory commits the new terms unconditionally once the merge is
      // empty, and the same has to hold here: if "IVES" turns out to have no sales either, the screen must say so about IVES. Keeping
      // the merged result on an empty retry would leave the chips and the empty message quoting ARIZONA, a term the operator had
      // already moved on from. Only a failed REQUEST falls through to the original.
      if (startFresh) {
        const fresh = await getSalesReport({ channel, window: win, steps: lastFind, sort, dir });
        if (fresh.success && fresh.data) {
          return { ...fresh, data: { ...fresh.data, usedSteps: lastFind } };
        }
      }
      return { ...res, data: { ...res.data, usedSteps: steps } };
    },
  );
  // The filter the loaded result actually used. After a start-fresh this is the newest terms alone, not the merged list — the chips, the
  // next Find and the empty state all build off it, so the screen always describes the filter that is actually on display.
  const usedSteps = data?.usedSteps ?? steps;

  // A Contains step is what flips the screen into product mode (and so dims the window control); a Does-not-contain step alone doesn't.
  const hasSteps = useMemo(() => usedSteps.filter((s) => s.op === 'has'), [usedSteps]);
  const willSearch = hasSteps.length > 0;
  // The term the result box quotes back — the opening Contains, which is the one that chose the matched set.
  const leadTerm = hasSteps[0]?.term ?? '';

  const rows: SalesReportRow[] = data?.rows ?? NO_ROWS;

  const summary: SalesReportSummary | null = data?.summary ?? null;
  // Memoised because a fresh object each render would re-run the CSV-export callback and the summary memo below.
  const range = useMemo(() => ({ from: data?.from ?? null, to: data?.to ?? null }), [data?.from, data?.to]);
  const searchActive = data?.searchActive ?? false; // reflects the loaded result (product mode vs window pulse)
  const summaryOnly = data?.summaryOnly ?? false;   // long window: totals only, no line list
  const truncated = data?.truncated ?? false;       // more lines matched than the cap — the only thing the row above the table says now

  // How the truncation badge names the rows it's describing — read from the LOADED result's sort (same rule as `usedSteps`: the screen
  // describes what is on display, never what has merely been requested). Date gets the plain temporal words; a product sort has no
  // natural "latest", so it says "First", which is literally true of any ordering.
  const loadedSort = data?.sort ?? sort;
  const loadedDir = data?.dir ?? dir;
  const truncLead = loadedSort === 'date' ? (loadedDir === 'desc' ? 'Latest' : 'Earliest') : 'First';

  // --- Update orders ----------------------------------------------------------------------------------------------------------
  // The run itself, and everything about handling it, lives in UpdateOrdersButton — the same control is on Customer Orders, and the
  // read of that header explains why it's in both places. This page keeps only the two things that are ITS business: where a failure
  // is displayed, and what goes stale after a run (new orders mean new sale rows, so the ledger below reloads).
  const [updateError, setUpdateError] = useState<string | null>(null);
  const onUpdated = useCallback(async () => { await refresh(); }, [refresh]);

  // A failed sync must not blank out a ledger that loaded perfectly well, so it takes precedence in the existing banner rather than
  // getting a banner of its own.
  const error = updateError ?? loadError?.message ?? null;

  // FIND — commit whatever is in the boxes as steps, then clear them (Inventory's behaviour). The re-query falls out of `steps` being a
  // dependency of load(); nothing fires until this runs, which is the point of dropping the debounce.
  const onFind = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const c = contains.trim();
    const n = notContains.trim();
    if (!c && !n) return;
    // The 3-char floor applies only to the FIRST Contains — the one that picks the matched set out of the whole table. Later terms just
    // narrow what it found, so a short one ("38") is fine.
    if (c && hasSteps.length === 0 && c.length < 3) {
      setHint('Type 3 or more characters to search a product.');
      return;
    }
    // A Does-not-contain on its own narrows the window you're on. That works in the line windows, but a long window shows no lines to
    // narrow (totals only) — say so rather than silently appearing to do nothing.
    if (!c && summaryOnly) {
      setHint('Pick Today / Yesterday / 3 days, or search a product, before excluding a term.');
      return;
    }
    const next: SalesFilterStep[] = [];
    if (c) next.push({ op: 'has', term: c });
    if (n) next.push({ op: 'not', term: n });
    // Build on `usedSteps`, not the raw `steps` state: after a start-fresh those differ, and appending to the filter that found nothing
    // would silently re-apply the steps that were just dropped — the operator would add a term and get an empty screen again for a
    // reason not on display anywhere. `lastFind` is what the start-fresh retry re-runs on its own if this narrowing empties the list.
    setSteps([...usedSteps, ...next]);
    setLastFind(next);
    setContains('');
    setNotContains('');
    setHint(null);
    containsRef.current?.focus();
  }, [contains, notContains, hasSteps.length, summaryOnly, usedSteps]);

  // RESET — drop every step, which drops the screen back to the window pulse (load() re-runs off the empty steps array).
  const onReset = useCallback(() => {
    setSteps([]);
    setLastFind([]);
    setContains('');
    setNotContains('');
    setHint(null);
    containsRef.current?.focus();
  }, []);

  // --- formatters --------------------------------------------------------------------------------------------------------------
  const money = (v: number | null) =>
    v === null ? '—' : `${v < 0 ? '-£' : '£'}${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`);
  const int = (v: number) => v.toLocaleString('en-GB');
  const CUR_YEAR = new Date().getFullYear();
  // '2026-07-11' -> '11 Jul'
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };
  // Row date: like fmtDate, but appends a 2-digit year when the sale ISN'T this year — so all-time (product-mode) rows can't confuse a
  // last-season "12 Jul" with this season's. This-year rows stay clean (no year).
  const fmtDay = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d + 'T00:00:00');
    const base = `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
    return dt.getFullYear() === CUR_YEAR ? base : `${base} ’${String(dt.getFullYear()).slice(-2)}`;
  };
  // Always-with-year (for the product-mode span label, which can straddle seasons): '6 Aug ’24'.
  const fmtWithYear = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })} ’${String(dt.getFullYear()).slice(-2)}`;
  };

  // --- CSV export (current filtered view) --------------------------------------------------------------------------------------
  const exportCsv = useCallback(() => {
    if (rows.length === 0) return;
    const header = ['Date', 'Time', 'Channel', 'Code', 'Size', 'Style', 'Brand', 'Product', 'Order', 'Qty', 'Sold price', 'Profit', 'Margin %'];
    const esc = (v: string | number | null) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) => [
      r.solddate, r.ordertime, CHANNEL_CHIP[r.channel]?.label ?? r.channel, r.code, r.size, r.groupid,
      r.brand, r.productname, r.ordernum, r.qty,
      r.soldprice === null ? '' : r.soldprice.toFixed(2),
      r.profit === null ? '' : r.profit.toFixed(2),
      r.marginPct === null ? '' : r.marginPct.toFixed(1),
    ].map(esc).join(','));
    const csv = [header.join(','), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = range.from && range.to ? (range.from === range.to ? range.from : `${range.from}_${range.to}`) : 'sales';
    a.href = url;
    a.download = `sales_${channel}_${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, channel, range]);

  const rangeLabel = useMemo(() => {
    if (!range.from || !range.to) return '';
    // Pulse mode: short, same-year day-month (the window is always current). Product mode: the item's first→last sale within the last 12
    // months — make the years explicit and add the sold DURATION, since the profit total is spread over that span (day-month alone hides it).
    if (!searchActive) {
      return range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;
    }
    const span = range.from === range.to ? fmtWithYear(range.from) : `${fmtWithYear(range.from)} – ${fmtWithYear(range.to)}`;
    const days = Math.round((new Date(range.to + 'T00:00:00').getTime() - new Date(range.from + 'T00:00:00').getTime()) / 86400000);
    const dur = days < 60 ? `${days}d` : `${Math.max(1, Math.round(days / 30.44))} mo`;
    return `${span} · ${dur}`;
  }, [range, searchActive]);

  return (
    <AppShell title="Sales" backHref="/analytics" backLabel="Reports">
      {/* SEARCH SITS FIRST, directly under the title (owner, 2026-07-25: "I just want to search for sales"). It used to sit below the
          explainer paragraph AND the headline tiles, which pushed the boxes to the fold — on a screen whose primary action is "find this
          product". The paragraph went entirely: two labelled boxes and a Find need no instructions, and the one genuinely non-obvious
          rule (long windows show totals, no lines) is already explained in place, by the panel that replaces the table. */}
      <form onSubmit={onFind} className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={containsRef}
                value={contains}
                onChange={(e) => { setContains(e.target.value.toUpperCase()); setHint(null); }}
                placeholder="e.g. ARIZONA"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => { setNotContains(e.target.value.toUpperCase()); setHint(null); }}
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
            title="Clear the search — back to the date windows"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>

        {/* Breadcrumb of committed steps — the record of how the current set was narrowed. Contains is brand-tinted, Does-not-contain
            struck through, same vocabulary as Inventory so the two screens read alike. */}
        {(usedSteps.length > 0 || hint) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
            {usedSteps.map((s, i) => (
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
            {/* A start-fresh is announced by NOTHING, matching Inventory (owner, 2026-07-27): the breadcrumb already shows exactly the
                steps now in force, and the operator has the rows they asked for — a banner explaining what didn't happen is just
                something to read. */}
            {hint && <span className="text-xs text-amber-600">{hint}</span>}
          </div>
        )}
      </form>

      {/* Filters: channel · window. A Contains search flips to product mode, so the window control dims. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented options={CHANNEL_TABS} value={channel} onChange={setChannel} />

        {/* Window: short group (with lines) · long group (totals only). Split so the different behaviour is visible before clicking. */}
        <div className="inline-flex items-center gap-2"
          title={willSearch ? 'Windows don’t apply while searching a product (showing all time)' : undefined}>
          <Segmented options={SHORT_WINDOW_TABS} value={win} onChange={setWin} disabled={willSearch} />
          <span className="text-slate-300" aria-hidden>·</span>
          <div className="inline-flex items-center gap-1.5">
            <Segmented options={LONG_WINDOW_TABS} value={win} onChange={setWin} disabled={willSearch} />
            <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">totals</span>
          </div>
        </div>

        {/* Update orders — parked at the right-hand end of the filter row that was already here, so it costs no vertical space.
            Failures go to the shared error banner below rather than getting one of their own. */}
        <UpdateOrdersButton className="ml-auto" onDone={onUpdated} onError={setUpdateError} />
      </div>

      {/* Headline strip — net profit is the hero; revenue / margin / units support it. Tiles run tighter than the rest of the module
          (p-3, supporting values one step down at text-xl) to buy back vertical space above the fold — which also widens the gap
          between the hero and its supporting numbers rather than flattening it. */}
      {summary && !error && (
        // Three tiles, not four: ORDERS was dropped (owner, 2026-07-30) because on this catalogue an order is almost always a single
        // pair, so it tracked Units sold closely enough to be a second copy of it taking up a column. Grid drops a column to match
        // (5->4 on lg, 4->3 on sm) so Revenue keeps its double width and the row stays full rather than leaving a hole.
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:col-span-1 lg:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Revenue{rangeLabel && <span className="ml-1 font-normal normal-case text-slate-400">· {rangeLabel}</span>}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums text-slate-800">{money(summary.revenue)}</div>
          </div>
          <Stat label="Net profit" value={money(summary.profit)}
            valueClassName={summary.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}
            sub={`${pct(summary.marginPct)} margin`} />
          {/* Units lead with NET (owner, 2026-07-30) — the gross figure was the headline until the returns badge went on, and with a
              45%-returned style the big number was then the one that hadn't happened. Net is what the money tiles beside it are already
              netted to, so the row now reads on one basis throughout. The gross is spelled out underneath as the equation it came from,
              so nothing is hidden — just demoted.
              "SOLD" labels the NET figure because that is what was actually sold and kept; the gross is "total" in the sub-line rather
              than "sold" precisely so the two can't both claim the word. Kept to one word each — this is a 3-line tile, and "20
              transactions − 9 returned" wraps at the tile's width on a laptop.
              The RETURN RATE rides on the label as a colour-graded pill — it's the number you want to catch without reading, and on this
              catalogue it's a real signal (a style returning at 45% is a sizing problem, not a pricing one). The bands are deliberately
              coarse: quiet grey under 15%, amber to 30%, red above — a traffic light, not a measurement. */}
          <Stat label="Sold" value={int(summary.unitsNet)}
            badge={summary.unitsSold > 0 && summary.unitsReturned > 0
              ? { text: `${pct((summary.unitsReturned / summary.unitsSold) * 100)} returned`, tone: returnTone((summary.unitsReturned / summary.unitsSold) * 100) }
              : undefined}
            sub={summary.unitsReturned
              ? `${int(summary.unitsSold)} total − ${int(summary.unitsReturned)} returned`
              : undefined} />
        </div>
      )}

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {/* Long window: the totals above ARE the view — the line list is intentionally omitted (a 30-90d list would be thousands of rows).
          Explain the absence so it reads as deliberate, and point to the two ways to get lines back. */}
      {!loading && !error && summaryOnly && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center">
          <p className="text-sm font-medium text-slate-600">Totals only for this window</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            The headline above covers all sales in the last {win === '7d' ? '7' : win === '30d' ? '30' : '90'} days. Individual lines
            aren’t listed over a longer window — pick <strong>Today / Yesterday / 3 days</strong> for the line list, or
            <strong> search a product</strong> to see its full history.
          </p>
        </div>
      )}

      {!loading && !error && !summaryOnly && (
        rows.length === 0 ? (
          // Reaching here means the widen already ran and came back empty too (or there was nothing left to widen to), so this is the
          // end of the line: the set really is empty. Say that once, plainly, and don't hint at a retry that has already happened.
          //
          // The horizon is read from the RESPONSE (`searchActive`), not inferred from the term: a Contains puts the server in product
          // mode and the window tabs stop applying, so quoting "last 12 months" is only true in that mode. A not-only filter is still
          // on the window, and gets the window wording.
          //
          // "No sales MATCHING x" — not "no sales FOR x" — on purpose. `sales` only holds things that sold, so an empty result cannot
          // tell a real product that hasn't sold from a term that matches no product at all (a typo returns exactly this). The looser
          // phrasing reports the search, which is all we actually know. Saying "for" would assert the product exists.
          <p className="text-sm text-slate-400">
            {searchActive && leadTerm
              ? <>No sales matching “{leadTerm}” in the last 12 months.</>
              : <>No sales match this filter.</>}
            {usedSteps.length > 0 && (
              <> <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.</>
            )}
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span className="flex flex-wrap items-center gap-2">
                {/* NO ROW COUNT HERE (owner, 2026-07-30). This line used to lead with "All 29 lines…", and it was doing more harm than
                    work: it restated something the table itself shows, and it spent the word "sales"/"lines" on the GROSS count while
                    the Sold tile above spends it on the NET one — two numbers a few inches apart, same vocabulary, different meaning.
                    That collision was the original confusion this whole pass started from, so the line is gone rather than reworded.
                    What survives is the pair of badges: they aren't a count, they answer "did my search land on ONE product?", which is
                    the thing you can't tell by looking at the rows.

                    THE ONE EXCEPTION is truncation, which nothing else on the screen can tell you. The tiles are uncapped server-side
                    aggregates, so they stay right; the TABLE is a page of at most `limit` rows and Export CSV writes only what's
                    loaded — so a capped list hands over a partial file that looks complete. This warns, and only then. It repeats none
                    of what's already above it (no term, no horizon, no product) and doesn't explain the cap: it says which rows these
                    are and what the export will hold, then stops.

                    Both badges lose the leading "· " and the ml-2 they used to need — with the count gone the row is a flex with a gap,
                    and a dangling separator in front of the first thing on the line reads as a rendering fault. */}
                {/* WORDED OFF THE SORT (2026-08-03). The cap is applied after the ORDER BY, so a truncated list isn't one fixed set of
                    rows re-arranged — sort ascending by date and these are the OLDEST 200, not the latest. "Latest" was hard-coded
                    when date-descending was the only order there was; left alone it would now be a false label on three of the four
                    combinations. `truncLead` derives it from the order actually in force. */}
                {truncated && summary && (
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 ring-1 ring-amber-200">
                    {truncLead} {int(rows.length)} of {int(summary.lines)} — CSV exports these {int(rows.length)}
                  </span>
                )}
                {searchActive && summary && summary.products > 1 && (
                  <span className="text-amber-600">Spans {int(summary.products)} products — refine to isolate one</span>
                )}
                {searchActive && summary && summary.products === 1 && rows[0].groupid && (
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
                    <CheckBadgeIcon className="h-3.5 w-3.5" /> One product · {rows[0].groupid}
                    <span className="font-normal text-emerald-600/70">(all sizes)</span>
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={exportCsv}
                className="font-medium text-slate-500 underline-offset-2 transition hover:text-slate-700 hover:underline"
                title="Download the current view as a CSV for Excel"
              >
                Export CSV
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    {/* Only these two sort (owner's ask). The rest stay plain headers rather than getting a disabled-looking
                        affordance — a header that looks clickable and isn't is worse than one that never invited the click. */}
                    <SortableTh label="When" col="date" sort={sort} dir={dir} onSort={onSort} />
                    <th className="px-4 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 font-medium">Brand</th>
                    <SortableTh label="Product" col="product" sort={sort} dir={dir} onSort={onSort} />
                    <th className="px-3 py-2.5 text-right font-medium">Sold</th>
                    <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                    <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                    <th className="px-4 py-2.5 font-medium">Order</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <SaleRow key={`${r.channel}-${r.code}-${r.ordernum}-${r.ordertime}-${i}`} r={r} onAction={rowAction}
                             money={money} pct={pct} fmtDate={fmtDay} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------
// A compact segmented control (channel / window). Generic over its option key.
// -------------------------------------------------------------------------------------------------------------------------------
function Segmented<T extends string>({ options, value, onChange, disabled = false, title }: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className={'inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 ' + (disabled ? 'opacity-50' : '')} title={title}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={
            'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
            (disabled ? 'cursor-not-allowed ' : '') +
            (value === o.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------
// A sortable column header. The arrow shows ONLY on the active column — an idle hint arrow on every sortable header turns the header
// row into a field of chevrons and stops the active one reading as the answer to "what am I looking at?". Hovering still tints, so the
// affordance is there when you go looking for it.
// aria-sort is what a screen reader announces; `scope="col"` because these are real column headers with a button inside, not a bare
// clickable div.
// -------------------------------------------------------------------------------------------------------------------------------
function SortableTh({ label, col, sort, dir, onSort, align = 'left' }: {
  label: string;
  col: SalesSort;
  sort: SalesSort;
  dir: SalesSortDir;
  onSort: (c: SalesSort) => void;
  align?: 'left' | 'right';
}) {
  const active = sort === col;
  const Arrow = dir === 'asc' ? ChevronUpIcon : ChevronDownIcon;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={'px-4 py-2.5 font-medium ' + (align === 'right' ? 'text-right' : '')}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        title={active ? `Sorted by ${label.toLowerCase()} — click to reverse` : `Sort by ${label.toLowerCase()}`}
        className={
          'group inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ' +
          'focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ' +
          (active ? 'text-slate-700' : '')
        }
      >
        {label}
        {active && <Arrow className="h-3.5 w-3.5 text-slate-400" aria-hidden />}
      </button>
    </th>
  );
}

// Return-rate traffic light. Coarse on purpose — the pill answers "is this normal?", and a footwear catalogue sold online carries a
// double-digit return rate as a matter of course, so the quiet band has to be generous or every tile would shout.
type StatTone = 'quiet' | 'warn' | 'bad';
function returnTone(ratePct: number): StatTone {
  if (ratePct >= 30) return 'bad';
  if (ratePct >= 15) return 'warn';
  return 'quiet';
}
const TONE_CLASS: Record<StatTone, string> = {
  quiet: 'bg-slate-100 text-slate-500',
  warn: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

// A supporting stat tile in the headline strip. The optional badge sits on the LABEL row, not next to the value: it's a qualifier on
// the number, and putting it beside the value would make two figures compete for the same glance.
function Stat({ label, value, sub, valueClassName, badge }: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  badge?: { text: string; tone: StatTone };
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        {badge && (
          <span className={'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ' + TONE_CLASS[badge.tone]}>
            {badge.text}
          </span>
        )}
      </div>
      <div className={'mt-1 text-xl font-semibold tabular-nums ' + (valueClassName ?? 'text-slate-800')}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------
// One sale line — column-aware clicks (no chooser menu, owner 2026-07-23):
//   • Channel badge -> the row's own channel pricing page    • Product cell -> copy groupid    • Order cell -> copy order number.
// Every other cell does NOTHING (owner: don't send them away from a click with no action). A non-priceable channel (not SHP/AMZ)
// leaves even the badge inert. Returns render red (negative qty + profit) — the row tint carries that, not a Qty column.
// -------------------------------------------------------------------------------------------------------------------------------
function SaleRow({ r, onAction, money, pct, fmtDate }: {
  r: SalesReportRow;
  onAction: (r: SalesReportRow) => void;
  money: (v: number | null) => string;
  pct: (v: number | null) => string;
  fmtDate: (d: string | null) => string;
}) {
  const chip = CHANNEL_CHIP[r.channel] ?? { label: r.channel, cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
  const isReturn = r.qty < 0;
  const profitCls = r.profit === null ? 'text-slate-400' : r.profit < 0 ? 'text-rose-600' : 'text-slate-700';
  const priceable = (r.channel === 'SHP' && !!r.groupid) || r.channel === 'AMZ';

  // Transient "Copied" flag on whichever copy cell was last clicked.
  const [copied, setCopied] = useState<null | 'groupid' | 'order'>(null);
  const copy = (key: 'groupid' | 'order', value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 900);
    }).catch(() => {});
  };

  // The channel badge is the only cell that navigates (and only when priceable). Everything except the copy cells is inert.
  const go = () => priceable && onAction(r);

  // Show the FULL code (owner 2026-07-29) — it already ends in the size (RIGHT(code,2)), so a separate size element was repeating it.
  // Fall back to the groupid on a row with no code. The copy click copies whatever is displayed.
  const groupKey = r.code || r.groupid || '';

  return (
    <tr
      className={'border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ' + (isReturn ? 'bg-rose-50/40' : '')}
    >
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
        {fmtDate(r.solddate)}
        {r.ordertime && <span className="ml-2 text-xs text-slate-400">{r.ordertime}</span>}
      </td>
      <td className="px-4 py-2.5">
        <span onClick={go}
              className={'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ' + chip.cls + (priceable ? ' cursor-pointer hover:brightness-95' : '')}
              title={priceable ? 'Open its pricing page' : undefined}>{chip.label}</span>
      </td>
      {/* Brand as its own column (trying it, owner 2026-07-29 — the alternative was a grey word inline next to the code). Nullable on
          legacy rows, hence the dash. */}
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{r.brand || '—'}</td>
      <td onClick={() => groupKey && copy('groupid', groupKey)}
          className={'px-4 py-2.5 ' + (groupKey ? 'cursor-pointer' : '')}
          title={groupKey ? 'Click to copy the code' : undefined}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tracking-tight text-slate-900">{groupKey || '—'}</span>
          {/* No Qty column (owner 2026-07-27: it is 1 on ~every line). The rare non-1 line still says so, inline. */}
          {r.qty !== 1 && (
            <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + (isReturn ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600')}>
              ×{r.qty}
            </span>
          )}
          {copied === 'groupid' && <span className="text-xs font-medium text-green-600">Copied</span>}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(r.soldprice)}</td>
      <td className={'px-3 py-2.5 text-right font-medium tabular-nums ' + profitCls}>{money(r.profit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(r.marginPct)}</td>
      <td onClick={() => r.ordernum && copy('order', r.ordernum)}
          className={'px-4 py-2.5 whitespace-nowrap text-xs text-slate-400 ' + (r.ordernum ? 'cursor-pointer' : '')}
          title={r.ordernum ? 'Click to copy the order number' : undefined}>
        {r.ordernum || '—'}
        {copied === 'order' && <span className="ml-1.5 font-medium text-green-600">Copied</span>}
      </td>
    </tr>
  );
}
