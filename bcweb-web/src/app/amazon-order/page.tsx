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
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { MagnifyingGlassIcon, XMarkIcon, ArrowPathIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getAmazonOrderList, AmazonOrderRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

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

type SortKey = 'code' | 'local_stock' | 'fba_live' | 'fba_total' | 'units_7d' | 'units_30d' | 'unit_profit' | 'profit_30d' | 'barcode' | 'amz_sku' | 'supplier';
// Reading order: identity (SKU, then the Order/Pick scratchpad rendered right after it — see below) -> what's in stock (local, then
// FBA) -> how it's selling -> what it's made -> the identifiers you'd look up but don't need to read every time (barcode/SKU/
// supplier), pushed to the end so they scroll off rather than crowd the working columns (owner request, 2026-08-07).
const COLUMNS: { key: SortKey; label: string; title?: string; align: 'left' | 'right' }[] = [
  { key: 'code', label: 'SKU (size)', align: 'left' },
  { key: 'local_stock', label: 'Local Stock', title: 'Sellable local stock (localstock, free & not deleted)', align: 'right' },
  { key: 'fba_live', label: 'FBA Live', title: 'Sellable-now FBA stock (amzfeed.amzlive)', align: 'right' },
  { key: 'fba_total', label: 'FBA Total', title: 'Live + inbound FBA stock (amzfeed.amztotal)', align: 'right' },
  { key: 'units_30d', label: 'Sold (30d)', title: 'Units sold, last 30 days', align: 'right' },
  { key: 'units_7d', label: 'Sold (7d)', title: 'Units sold, last 7 days', align: 'right' },
  { key: 'unit_profit', label: 'Unit profit', title: "Per-unit profit of the SKU's last Amazon sale (skumap.amzprofit)", align: 'right' },
  { key: 'profit_30d', label: 'Profit (30d)', title: 'unit_profit x Sold (30d)', align: 'right' },
  { key: 'barcode', label: 'Barcode', title: 'skumap.ean, trailing B stripped', align: 'left' },
  { key: 'amz_sku', label: 'Amazon SKU', title: 'Amazon Seller SKU (amzfeed.sku)', align: 'left' },
  { key: 'supplier', label: 'Supplier', align: 'left' },
];
// Text columns default A-Z; every numeric column defaults high-to-low (the biggest number is usually the interesting end).
const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  code: 'asc', local_stock: 'desc', fba_live: 'desc', fba_total: 'desc', units_7d: 'desc', units_30d: 'desc',
  unit_profit: 'desc', profit_30d: 'desc', barcode: 'asc', amz_sku: 'asc', supplier: 'asc',
};

// The value a row sorts on for a given key. Nulls sort last regardless of direction (an unknown price/profit is not "small").
function sortValue(r: AmazonOrderRow, key: SortKey): number | string | null {
  if (key === 'barcode' || key === 'amz_sku' || key === 'supplier') return r[key] ? r[key]!.toLowerCase() : null;
  return r[key];
}

// Shared <th> renderer — pulled out so the SKU column can be rendered on its own (Order/Pick slot in right after it) while every
// other column still comes from one shared COLUMNS.map.
function renderColumnHeader(
  c: { key: SortKey; label: string; title?: string; align: 'left' | 'right' },
  sortKey: SortKey, sortDir: 'asc' | 'desc', onSort: (key: SortKey) => void,
) {
  const active = sortKey === c.key;
  return (
    <th
      key={c.key}
      title={c.title}
      onClick={() => onSort(c.key)}
      className={
        'cursor-pointer select-none whitespace-nowrap px-4 py-2 font-medium hover:text-slate-700 ' +
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
  const { data, error: loadError, isLoading: loading } = useApiQuery(
    ['amazon-order-list'],
    () => getAmazonOrderList(),
  );
  const rows: AmazonOrderRow[] = data?.rows ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // Committed steps — each Enter/Add stacks another one; multiple of the same kind AND together.
  const [includes, setIncludes] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [includeInput, setIncludeInput] = useState('');
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
  function removeInclude(t: string) { setIncludes((prev) => prev.filter((x) => x !== t)); }
  function removeExclude(t: string) { setExcludes((prev) => prev.filter((x) => x !== t)); }
  // Reset — clears every applied filter (and whatever's mid-typed in the boxes), back to the whole list.
  function onReset() { setIncludes([]); setExcludes([]); setIncludeInput(''); setExcludeInput(''); }

  const filtered = useMemo(() => {
    if (includes.length === 0 && excludes.length === 0) return rows;
    const incTerms = includes.map((t) => t.toLowerCase());
    const excRes = excludes.map((t) => new RegExp(`\\b${escapeRegExp(t.toLowerCase())}\\b`));
    return rows.filter((r) => {
      const hay = haystack(r);
      if (incTerms.some((t) => !hay.includes(t))) return false;
      if (excRes.some((re) => re.test(hay))) return false;
      return true;
    });
  }, [rows, includes, excludes]);

  const filtering = includes.length > 0 || excludes.length > 0;

  const [sortKey, setSortKey] = useState<SortKey>('profit_30d');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(DEFAULT_DIR[key]); }
  };

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Nulls always sort last, independent of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const d = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      if (d === 0) return a.code.localeCompare(b.code);
      return d * dir;
    });
  }, [filtered, sortKey, sortDir]);

  // Order / Pick — a session-only planning scratchpad, keyed by code. NOT sent anywhere or persisted (owner decision, 2026-08-07):
  // reloading the page clears them, same as any other unsaved browser state. Kept as free text rather than <input type="number"> so a
  // half-typed value never gets silently clamped/rounded mid-entry.
  const [orderQty, setOrderQty] = useState<Record<string, string>>({});
  const [pickQty, setPickQty] = useState<Record<string, string>>({});

  return (
    <AppShell title="Amazon Order" backHref="/dashboard" backLabel="Dashboard">
      {/* Search bar — Enter commits the box as a step; steps stack and AND together. */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Include</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                value={includeInput}
                onChange={(e) => setIncludeInput(e.target.value)}
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
              onChange={(e) => setExcludeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExclude(); } }}
              placeholder="e.g. black, then Enter"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            type="button"
            onClick={onReset}
            disabled={!filtering}
            title="Clear every filter and show the whole list"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Reset
          </button>
        </div>

        {/* Chips for each committed step, plus the row count. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
          <span className="mr-1 whitespace-nowrap text-slate-500">
            {filtering ? (
              <>Rows: <span className="font-semibold text-slate-800">{filtered.length}</span><span className="text-slate-400"> of {rows.length}</span></>
            ) : (
              <><span className="font-semibold text-slate-800">{rows.length}</span><span className="text-slate-400"> SKUs</span></>
            )}
          </span>
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
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-max min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {/* Order/Pick sit right after Sold (7d) — COLUMNS[0..5] is code/local_stock/fba_live/fba_total/units_30d/units_7d
                    (6 columns), then the scratchpad, then everything from unit_profit onward. */}
                {COLUMNS.slice(0, 6).map((c) => renderColumnHeader(c, sortKey, sortDir, onSort))}
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="Planning scratchpad — not saved, cleared on reload">Order</th>
                <th className="whitespace-nowrap px-4 py-2 text-right font-medium" title="Planning scratchpad — not saved, cleared on reload">Pick</th>
                {COLUMNS.slice(6).map((c) => renderColumnHeader(c, sortKey, sortDir, onSort))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => (
                <tr key={r.code}>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.code}</td>
                  <td className={'whitespace-nowrap px-4 py-2 text-right ' + (r.local_stock === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.local_stock}</td>
                  <td className={'whitespace-nowrap px-4 py-2 text-right ' + (r.fba_live === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.fba_live}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-slate-700">{r.fba_total}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-slate-700">{r.units_30d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-slate-700">{r.units_7d || <span className="text-slate-300">0</span>}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <input
                      value={orderQty[r.code] || ''}
                      onChange={(e) => setOrderQty((prev) => ({ ...prev, [r.code]: e.target.value }))}
                      inputMode="numeric"
                      placeholder="—"
                      className="w-16 rounded-md border border-slate-200 px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <input
                      value={pickQty[r.code] || ''}
                      onChange={(e) => setPickQty((prev) => ({ ...prev, [r.code]: e.target.value }))}
                      inputMode="numeric"
                      placeholder="—"
                      className="w-16 rounded-md border border-slate-200 px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-slate-700">{money(r.unit_profit)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-medium text-slate-800">{money(r.profit_30d)}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.barcode || <span className="text-slate-300">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.amz_sku || <span className="text-slate-300">—</span>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">{r.supplier || <span className="text-slate-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No SKUs match.</div>
          )}
        </div>
      )}
    </AppShell>
  );
}
