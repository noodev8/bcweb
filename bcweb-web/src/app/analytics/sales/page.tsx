'use client';
/*
=======================================================================================================================================
Page: /analytics/sales  (Analytics module — Sales)
=======================================================================================================================================
Purpose: The sales ledger an analyst opens to answer "how are we doing?" — recent sale lines with the PROFIT already computed downstream,
         under a headline strip whose hero is NET PROFIT (with revenue, margin and units supporting). The reframed successor to the legacy
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

         Export CSV builds from the loaded rows (the current filtered view) so the analyst can carry it into Excel. Row click reuses the
         cross-module ProductActions chooser (reprice / copy), same as Price Changes.

Guarded by AppShell. Consumes GET /analytics-sales.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CheckBadgeIcon, MagnifyingGlassIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { getSalesReport, SalesFilterStep, SalesReportRow, SalesReportSummary, SalesWindow } from '@/lib/api';

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

export default function SalesPage() {
  const { logout } = useAuth();
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

  // The two boxes, and the ordered steps committed so far (same model as Inventory). Steps are display-only here too: to drop one, Reset.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const [steps, setSteps] = useState<SalesFilterStep[]>([]);
  const [hint, setHint] = useState<string | null>(null);  // inline "why nothing happened" note on a rejected Find
  const containsRef = useRef<HTMLInputElement>(null);     // Reset / Find hand focus back here for the next term

  const [rows, setRows] = useState<SalesReportRow[]>([]);
  const [summary, setSummary] = useState<SalesReportSummary | null>(null);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [searchActive, setSearchActive] = useState(false); // reflects the loaded result (product mode vs window pulse)
  const [summaryOnly, setSummaryOnly] = useState(false);   // long window: totals only, no line list
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A Contains step is what flips the screen into product mode (and so dims the window control); a Does-not-contain step alone doesn't.
  const hasSteps = useMemo(() => steps.filter((s) => s.op === 'has'), [steps]);
  const willSearch = hasSteps.length > 0;
  // The term the result box quotes back — the opening Contains, which is the one that chose the matched set.
  const leadTerm = hasSteps[0]?.term ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getSalesReport({ channel, window: win, steps });
    if (res.success && res.data) {
      setRows(res.data.rows);
      setSummary(res.data.summary);
      setRange({ from: res.data.from, to: res.data.to });
      setSearchActive(res.data.searchActive);
      setSummaryOnly(res.data.summaryOnly);
      setTruncated(res.data.truncated);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Sales');
    }
    setLoading(false);
  }, [channel, win, steps, logout]);

  useEffect(() => { load(); }, [load]);

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
    setSteps((prev) => [...prev, ...next]);
    setContains('');
    setNotContains('');
    setHint(null);
    containsRef.current?.focus();
  }, [contains, notContains, hasSteps.length, summaryOnly]);

  // RESET — drop every step, which drops the screen back to the window pulse (load() re-runs off the empty steps array).
  const onReset = useCallback(() => {
    setSteps([]);
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
    const header = ['Date', 'Time', 'Channel', 'Code', 'Size', 'Style', 'Product', 'Order', 'Qty', 'Sold price', 'Profit', 'Margin %'];
    const esc = (v: string | number | null) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map((r) => [
      r.solddate, r.ordertime, CHANNEL_CHIP[r.channel]?.label ?? r.channel, r.code, r.size, r.groupid,
      r.productname, r.ordernum, r.qty,
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
    <AppShell title="Sales" backHref="/analytics" backLabel="Analytics">
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
        {(steps.length > 0 || hint) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
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
      </div>

      {/* Headline strip — net profit is the hero; revenue / margin / units support it. Tiles run tighter than the rest of the module
          (p-3, supporting values one step down at text-xl) to buy back vertical space above the fold — which also widens the gap
          between the hero and its supporting numbers rather than flattening it. */}
      {summary && !error && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:col-span-1 lg:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Net profit{rangeLabel && <span className="ml-1 font-normal normal-case text-slate-400">· {rangeLabel}</span>}</div>
            <div className={'mt-1 text-3xl font-bold tabular-nums ' + (summary.profit < 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {money(summary.profit)}
            </div>
            <div className="mt-1 text-xs text-slate-400">{pct(summary.marginPct)} margin</div>
          </div>
          <Stat label="Revenue" value={money(summary.revenue)} />
          {/* Units lead with SOLD (gross) — the same basis as Orders — so the pair reads naturally (units >= orders). Returns are netted
              into the money tiles above and shown here as a sub-line (with the return rate = returned / sold), so they stay visible
              without dragging the headline below Orders. */}
          <Stat label="Units" value={int(summary.unitsSold)}
            sub={summary.unitsReturned
              ? `${int(summary.unitsNet)} net · ${int(summary.unitsReturned)} returned${summary.unitsSold > 0 ? ` (${pct((summary.unitsReturned / summary.unitsSold) * 100)})` : ''}`
              : undefined} />
          <Stat label="Orders" value={int(summary.orders)} />
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
          <p className="text-sm text-slate-400">
            No sales match this filter.
            {steps.length > 0 && (
              <> <button type="button" onClick={onReset} className="text-brand-600 underline">Reset</button> to start again.</>
            )}
          </p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>
                {/* Product mode quotes the real matched-line count from the server (summary.lines), so "latest 200 of 318" is honest —
                    and once a narrowing step brings the set under the cap it says "All 47", which is the signal that what you're looking
                    at (and what Export CSV will write) is the complete set, not a page of it. */}
                {searchActive
                  ? truncated
                    ? `Latest ${int(rows.length)} of ${int(summary?.lines ?? rows.length)} sales for “${leadTerm}”, last 12 months`
                    : `All ${int(rows.length)} sales for “${leadTerm}”, last 12 months`
                  : truncated
                    ? `Showing the latest ${int(rows.length)} lines (more exist — narrow the window or search)`
                    : `${int(rows.length)} lines`}
                {searchActive && summary && summary.products > 1 && (
                  <span className="ml-2 text-amber-600">· spans {int(summary.products)} products — refine to isolate one</span>
                )}
                {searchActive && summary && summary.products === 1 && rows[0].groupid && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">
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
                    <th className="px-4 py-2.5 font-medium">When</th>
                    <th className="px-4 py-2.5 font-medium">Channel</th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
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

// A supporting stat tile in the headline strip.
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------
// One sale line — column-aware clicks (no chooser menu, owner 2026-07-23):
//   • Channel badge -> the row's own channel pricing page    • Product cell -> copy groupid    • Order cell -> copy order number.
// Every other cell does NOTHING (owner: don't send them away from a click with no action). A non-priceable channel (not SHP/AMZ)
// leaves even the badge inert. Returns render red (negative qty + profit).
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

  const groupKey = r.groupid || r.code || '';

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
      <td onClick={() => groupKey && copy('groupid', groupKey)}
          className={'px-4 py-2.5 ' + (groupKey ? 'cursor-pointer' : '')}
          title={groupKey ? 'Click to copy the groupid' : undefined}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tracking-tight text-slate-900">{groupKey || '—'}</span>
          {r.size && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{r.size}</span>}
          {copied === 'groupid' && <span className="text-xs font-medium text-green-600">Copied</span>}
        </div>
        <div className="max-w-[20rem] truncate text-xs text-slate-400">{r.productname || 'Untitled'}</div>
      </td>
      <td className={'px-3 py-2.5 text-right tabular-nums ' + (isReturn ? 'font-medium text-rose-600' : 'text-slate-700')}>{r.qty}</td>
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
