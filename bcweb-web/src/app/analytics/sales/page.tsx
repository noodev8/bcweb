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

         Export CSV builds from the loaded rows (the current filtered view) so the analyst can carry it into Excel. Row click reuses the
         cross-module ProductActions chooser (reprice / copy), same as Price Changes.

Guarded by AppShell. Consumes GET /analytics-sales.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckBadgeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useProductActions } from '@/components/ProductActions';
import { useAuth } from '@/contexts/AuthContext';
import { getSalesReport, SalesReportRow, SalesReportSummary, SalesWindow } from '@/lib/api';

type ChannelFilter = 'all' | 'shp' | 'amz';

const CHANNEL_TABS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
];

const WINDOW_TABS: { key: SalesWindow; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '3d', label: '3 days' },
];

// Per-channel chip identity (compact — this is a dense table). Tints match the rest of the module (Shopify=emerald, Amazon=amber).
const CHANNEL_CHIP: Record<string, { label: string; cls: string }> = {
  SHP: { label: 'Shopify', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  AMZ: { label: 'Amazon', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  CM3: { label: 'CM3', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export default function SalesPage() {
  const { logout } = useAuth();
  const actions = useProductActions();

  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [win, setWin] = useState<SalesWindow>('today');
  const [searchInput, setSearchInput] = useState<string>(''); // raw box value
  const [search, setSearch] = useState<string>('');           // debounced/committed term sent to the server

  const [rows, setRows] = useState<SalesReportRow[]>([]);
  const [summary, setSummary] = useState<SalesReportSummary | null>(null);
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  const [searchActive, setSearchActive] = useState(false); // reflects the loaded result (product mode vs window pulse)
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search needs >= 3 chars to fire (keeps half-typed fragments from dragging back the whole table). A 1-2 char box holds the screen in
  // window mode. Debounced so we don't request per keystroke.
  const typedTerm = searchInput.trim();
  const willSearch = typedTerm.length >= 3;
  useEffect(() => {
    const t = setTimeout(() => setSearch(typedTerm.length >= 3 ? typedTerm : ''), 350);
    return () => clearTimeout(t);
  }, [typedTerm]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getSalesReport({ channel, window: win, search: search || null });
    if (res.success && res.data) {
      setRows(res.data.rows);
      setSummary(res.data.summary);
      setRange({ from: res.data.from, to: res.data.to });
      setSearchActive(res.data.searchActive);
      setTruncated(res.data.truncated);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Sales');
    }
    setLoading(false);
  }, [channel, win, search, logout]);

  useEffect(() => { load(); }, [load]);

  // --- formatters --------------------------------------------------------------------------------------------------------------
  const money = (v: number | null) => (v === null ? '—' : `${v < 0 ? '-£' : '£'}${Math.abs(v).toFixed(2)}`);
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
    // Pulse mode: short, same-year day-month (the window is always current). Product mode: all-time, so make the years explicit and add
    // the sold DURATION — the profit total is spread over that span (could be several seasons), which the day-month alone would hide.
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
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        Recent sales with the profit on each line, netted for returns. Watch <strong>net profit</strong> for the window — or
        <strong> search a product</strong> to pull its <strong>whole sales history</strong> (latest 50), with lifetime totals to judge how
        it&apos;s doing. Export the current view to Excel any time.
      </p>

      {/* Filters: channel · window · search · export. Searching flips to product mode, so the window control dims (it doesn't apply). */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented options={CHANNEL_TABS} value={channel} onChange={setChannel} />
        <Segmented options={WINDOW_TABS} value={win} onChange={setWin} disabled={willSearch}
          title={willSearch ? 'Windows don’t apply while searching a product (showing all time)' : undefined} />

        <div className="relative min-w-[16rem] flex-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value.toUpperCase())}
            placeholder="Search product, style or SKU…"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 pr-16 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
          {typedTerm.length > 0 && typedTerm.length < 3 && (
            <span className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-xs text-slate-400">type 3+ chars</span>
          )}
          {searchInput.length > 0 && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              title="Clear search — back to the date windows"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Headline strip — net profit is the hero; revenue / margin / units support it. */}
      {summary && !error && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-1 lg:col-span-2">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Net profit{rangeLabel && <span className="ml-1 font-normal normal-case text-slate-400">· {rangeLabel}</span>}</div>
            <div className={'mt-1 text-3xl font-bold tabular-nums ' + (summary.profit < 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {money(summary.profit)}
            </div>
            <div className="mt-1 text-xs text-slate-400">{pct(summary.marginPct)} margin</div>
          </div>
          <Stat label="Revenue" value={money(summary.revenue)} />
          <Stat label="Units (net)" value={int(summary.unitsNet)}
            sub={`${int(summary.unitsSold)} sold${summary.unitsReturned ? ` · ${int(summary.unitsReturned)} returned` : ''}`} />
          <Stat label="Orders" value={int(summary.orders)} />
        </div>
      )}

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        rows.length === 0 ? (
          <p className="text-sm text-slate-400">No sales match this filter.</p>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-400">
              <span>
                {searchActive
                  ? `Latest ${int(rows.length)} sales for “${search}”, all time${truncated ? ' (this style has more)' : ''}`
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
                    <SaleRow key={`${r.channel}-${r.code}-${r.ordernum}-${r.ordertime}-${i}`} r={r} actions={actions}
                             money={money} pct={pct} fmtDate={fmtDay} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {actions.node}
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
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------
// One sale line. Clickable -> the cross-module reprice/copy chooser. Amazon rows pass their exact SKU code so the Amazon action
// deep-links straight to that size's drill; Shopify/CM3 use the resolved groupid. Returns render red (negative qty + profit).
// -------------------------------------------------------------------------------------------------------------------------------
function SaleRow({ r, actions, money, pct, fmtDate }: {
  r: SalesReportRow;
  actions: ReturnType<typeof useProductActions>;
  money: (v: number | null) => string;
  pct: (v: number | null) => string;
  fmtDate: (d: string | null) => string;
}) {
  const chip = CHANNEL_CHIP[r.channel] ?? { label: r.channel, cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
  const isReturn = r.qty < 0;
  const actionKey = r.groupid || r.code || '';
  const profitCls = r.profit === null ? 'text-slate-400' : r.profit < 0 ? 'text-rose-600' : 'text-slate-700';

  return (
    <tr
      onClick={(e) => actionKey && actions.open(e, actionKey, { title: r.productname, amzCode: r.channel === 'AMZ' ? r.code : null })}
      className={'cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60 ' + (isReturn ? 'bg-rose-50/40' : '')}
      title="Click to reprice or copy"
    >
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
        {fmtDate(r.solddate)}
        {r.ordertime && <span className="ml-2 text-xs text-slate-400">{r.ordertime}</span>}
      </td>
      <td className="px-4 py-2.5">
        <span className={'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ' + chip.cls}>{chip.label}</span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tracking-tight text-slate-900">{r.groupid || r.code || '—'}</span>
          {r.size && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{r.size}</span>}
        </div>
        <div className="max-w-[20rem] truncate text-xs text-slate-400">{r.productname || 'Untitled'}</div>
      </td>
      <td className={'px-3 py-2.5 text-right tabular-nums ' + (isReturn ? 'font-medium text-rose-600' : 'text-slate-700')}>{r.qty}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{money(r.soldprice)}</td>
      <td className={'px-3 py-2.5 text-right font-medium tabular-nums ' + profitCls}>{money(r.profit)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{pct(r.marginPct)}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-xs text-slate-400">{r.ordernum || '—'}</td>
    </tr>
  );
}
