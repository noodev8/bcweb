'use client';
/*
=======================================================================================================================================
Page: /amz  (Amazon Pricing module — the whole module is ONE page)
=======================================================================================================================================
Purpose: The lean, SKU-grain Amazon pricing screen (see docs/amz-pricing-spec.md). Unlike Shopify (segment list -> segment page ->
         drill), Amazon is a single page:
           - a strip of SEGMENT CHIPS across the top (+ an "All" chip), each with a needs-attention badge. Selecting a chip is the
             delegation primitive — it bounds the whole screen to that segment and is shareable via ?segment=.
           - one row PER SKU (each size is its own Amazon price), carrying its signals AND a suggested move (🟢 creep/drop/revert to
             accept, 🟡 a judgment call to look at, ⚪ hold). Both price directions live in one list, so there is no Winners|Losers split.
         This is the READ side: it shows the list and the suggestions. Inline apply + the one-file upload basket arrive with their
         endpoints (POST /amz-apply, GET /amz-upload-file) — the suggested target is shown but not yet actionable here.
=======================================================================================================================================
*/

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon, XMarkIcon, ChevronRightIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getAmzSegments, getAmzSkus, getAmzSku, applyAmzPrice, AmzSegmentRow, AmzSkuRow, AmzSkuDetail } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AmzContent />
    </Suspense>
  );
}

function money(v: number | null): string {
  return v !== null && v !== undefined ? `£${v.toFixed(2)}` : '—';
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

// Per-tier visual language: green = a move to accept, amber = a judgment call, white = hold (muted, sinks to the bottom).
const TIER = {
  green: { row: 'bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-800', dot: '🟢' },
  amber: { row: 'bg-amber-50/40', badge: 'bg-amber-100 text-amber-800', dot: '🟡' },
  white: { row: '', badge: 'bg-slate-100 text-slate-500', dot: '⚪' },
} as const;

const ACTION_LABEL: Record<string, string> = { creep: 'creep ↑', drop: 'drop ↓', revert: 'revert ↺', hold: 'hold' };

// One queued change in the session upload basket. Everything needed to build the Seller Central file lives on the row already
// (amz_sku, rrp) so the file is built client-side — no reliance on the server's phantom-diff (which pollutes with stale history).
interface AppliedItem { code: string; amz_sku: string; old_price: number | null; new_price: number; rrp: number | null; segment: string; }

// Build + download the ONE tab-separated upload file from the session basket (sku, price, min blank, max = RRP).
function downloadUploadFile(items: AppliedItem[]) {
  const header = 'sku\tprice\tminimum-seller-allowed-price\tmaximum-seller-allowed-price';
  const lines = items.map((i) => `${i.amz_sku}\t${i.new_price.toFixed(2)}\t\t${i.rrp != null ? i.rrp.toFixed(2) : ''}`);
  const content = [header, ...lines].join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'AMZ-Price-Upload.txt';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function AmzContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { logout } = useAuth();

  // null = the "All" chip (every managed SKU).
  const segParam = searchParams.get('segment');
  const segment: string | null = segParam || null;

  const [chips, setChips] = useState<AmzSegmentRow[] | null>(null);
  const [rows, setRows] = useState<AmzSkuRow[] | null>(null);
  const [loadingChips, setLoadingChips] = useState(true);
  const [loadingRows, setLoadingRows] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search across ALL managed SKUs by group id / code / title (SKUs can be random, so group id is the useful key). Deliberately
  // segment-independent — you're looking for a style wherever it lives — so a search overrides the chip view while it's active.
  const [search, setSearch] = useState('');
  const [allRows, setAllRows] = useState<AmzSkuRow[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const searching = search.trim().length > 0;

  // The session upload basket: code -> queued change. Persists across chip/search switches for the sitting; cleared after download.
  const [applied, setApplied] = useState<Record<string, AppliedItem>>({});
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  // Apply one price (W-A1). Records the audit row server-side and adds it to the basket. Returns success so callers can batch.
  async function handleApply(row: AmzSkuRow, price: number, note: string): Promise<boolean> {
    const res = await applyAmzPrice(row.code, price, note);
    if (res.return_code === 'UNAUTHORIZED') { logout(); return false; }
    if (res.success && res.data) {
      const d = res.data;
      setApplied((a) => ({ ...a, [row.code]: { code: row.code, amz_sku: row.amz_sku, old_price: d.old_price ?? row.current_price, new_price: d.new_price, rrp: row.rrp, segment: row.segment } }));
      if (d.warnings.includes('ABOVE_RRP')) setApplyMsg(`${row.code}: applied ${money(d.new_price)} — above RRP.`);
      return true;
    }
    setApplyMsg(res.error || `Couldn't apply ${row.code}.`);
    return false;
  }

  // Accept every 🟢 green suggestion currently shown that isn't already queued — the fast lane.
  const [bulkBusy, setBulkBusy] = useState(false);
  async function acceptAllGreens(list: AmzSkuRow[]) {
    setBulkBusy(true);
    setApplyMsg(null);
    for (const r of list) {
      if (r.suggestion.tier !== 'green' || r.suggestion.target === null || applied[r.code]) continue;
      // eslint-disable-next-line no-await-in-loop
      await handleApply(r, r.suggestion.target, r.suggestion.why);
    }
    setBulkBusy(false);
  }

  // Chips load once.
  useEffect(() => {
    (async () => {
      const res = await getAmzSegments();
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (res.success && res.data) setChips(res.data);
      else setError(res.error || 'Failed to load segments');
      setLoadingChips(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The SKU list reloads whenever the selected chip changes.
  useEffect(() => {
    (async () => {
      setLoadingRows(true);
      const res = await getAmzSkus(segment || undefined);
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (res.success && res.data) { setRows(res.data.rows); setError(null); }
      else setError(res.error || 'Failed to load SKUs');
      setLoadingRows(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  // Lazily fetch the whole managed set the first time a search is used; it's cached for the session after that.
  useEffect(() => {
    if (!searching || allRows !== null || loadingAll) return;
    (async () => {
      setLoadingAll(true);
      const res = await getAmzSkus(undefined); // undefined => every managed SKU
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (res.success && res.data) setAllRows(res.data.rows);
      setLoadingAll(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !allRows) return [];
    return allRows.filter((r) =>
      r.groupid.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.title ? r.title.toLowerCase().includes(q) : false)
    );
  }, [search, allRows]);

  function selectSegment(seg: string | null) {
    router.replace(seg ? `/amz?segment=${encodeURIComponent(seg)}` : '/amz');
  }

  // "All" chip totals (summed client-side per the spec).
  const allTotals = useMemo(() => {
    if (!chips) return { attention: 0, skus: 0 };
    return chips.reduce((a, c) => ({ attention: a.attention + c.attention_count, skus: a.skus + c.sku_count }), { attention: 0, skus: 0 });
  }, [chips]);

  // Economics caption (only when a single segment is active). Params are per-row server-side; here we surface a representative set
  // from the rows (cost/FBA/RRP are ~uniform within a segment) so the operator sees the frame their suggestions are judged against.
  const econ = useMemo(() => {
    if (!segment || !rows || rows.length === 0) return null;
    const withCost = rows.find((r) => r.cost !== null) || rows[0];
    const cost = withCost.cost, fbafee = withCost.fbafee, rrp = withCost.rrp;
    const floor = cost !== null && fbafee !== null ? Math.round((cost + fbafee) * 100) / 100 : null;
    return { cost, fbafee, floor, rrp };
  }, [segment, rows]);

  const tierCounts = useMemo(() => {
    const c = { green: 0, amber: 0, white: 0 };
    (rows || []).forEach((r) => { c[r.suggestion.tier]++; });
    return c;
  }, [rows]);

  return (
    <AppShell title="Amazon Pricing" backHref="/dashboard" backLabel="Dashboard">
      {/* SEARCH — group id / code / name, across every segment. Overrides the chip view while active. */}
      <div className="relative mb-4">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all segments by group id, code or name (e.g. charl)…"
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        {search && (
          <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Clear search">
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* UPLOAD BASKET — queued changes for this sitting. Build the one file and upload it to Seller Central when it suits. */}
      {Object.keys(applied).length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-900">{Object.keys(applied).length} price change{Object.keys(applied).length === 1 ? '' : 's'} queued</span>
          <button
            type="button"
            onClick={() => downloadUploadFile(Object.values(applied))}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
          >
            <ArrowDownTrayIcon className="h-4 w-4" /> Download upload file
          </button>
          <button type="button" onClick={() => setApplied({})} className="text-xs text-slate-500 hover:text-slate-700 hover:underline">
            clear queue
          </button>
          <span className="text-xs text-brand-700/80">one file for Seller Central · clear once uploaded</span>
        </div>
      )}
      {applyMsg && (
        <div className="mb-3 flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>{applyMsg}</span>
          <button type="button" onClick={() => setApplyMsg(null)} className="text-amber-600 hover:text-amber-800"><XMarkIcon className="h-4 w-4" /></button>
        </div>
      )}

      {/* SEGMENT CHIPS — the filter + delegation strip. Hidden while searching (a search is cross-segment). */}
      {!searching && loadingChips && <p className="text-sm text-slate-400">Loading segments…</p>}
      {!searching && chips && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          <Chip label="All" attention={allTotals.attention} count={allTotals.skus} active={segment === null} onClick={() => selectSegment(null)} />
          {chips.map((c) => (
            <Chip key={c.segment} label={c.segment} attention={c.attention_count} count={c.sku_count} active={segment === c.segment} onClick={() => selectSegment(c.segment)} />
          ))}
        </div>
      )}

      {/* SEARCH RESULTS — replaces the chip list while a term is present. */}
      {searching && (
        <>
          {loadingAll && <p className="text-sm text-slate-400">Searching…</p>}
          {!loadingAll && (
            <>
              <p className="mb-2 text-xs text-slate-400">
                {matches.length} match{matches.length === 1 ? '' : 'es'} for “{search.trim()}” across all segments
              </p>
              {matches.length === 0
                ? <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No SKUs match “{search.trim()}”. Try a group id or code fragment.</div>
                : <SkuTable rows={matches} showSegment applied={applied} onApply={handleApply} />}
            </>
          )}
        </>
      )}

      {/* Economics caption — the frame for this segment's suggestions. */}
      {!searching && econ && (
        <p className="mb-3 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{segment}</span>
          {'  ·  '}cost {money(econ.cost)}{'  ·  '}FBA {money(econ.fbafee)}{'  ·  '}floor {money(econ.floor)}{'  ·  '}RRP {money(econ.rrp)}
        </p>
      )}

      {!searching && error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!searching && loadingRows && <p className="text-sm text-slate-400">Loading SKUs…</p>}

      {!searching && !loadingRows && rows && rows.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">No Amazon SKUs here.</div>
      )}

      {!searching && !loadingRows && rows && rows.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span><span className="font-semibold text-emerald-700">{tierCounts.green}</span> to action</span>
            <span><span className="font-semibold text-amber-700">{tierCounts.amber}</span> to review</span>
            <span>{tierCounts.white} holding</span>
            <span className="text-slate-300">·</span>
            <span>sorted by action, then most FBA stock first</span>
            {/* The fast lane: accept every green suggestion not already queued, in one click. */}
            {(() => {
              const greens = (rows || []).filter((r) => r.suggestion.tier === 'green' && r.suggestion.target !== null && !applied[r.code]);
              if (greens.length === 0) return null;
              return (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => acceptAllGreens(rows || [])}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {bulkBusy ? 'Applying…' : `Accept all ${greens.length} greens`}
                </button>
              );
            })()}
          </div>

          {/* Where the recommendation comes from — collapsed by default, one click to see the rules. */}
          <details className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700">How is the suggested move worked out?</summary>
            <div className="mt-2 space-y-1.5 leading-relaxed">
              <p>
                Each size is scored by the <span className="font-medium">Brookfield Amazon pricing rules</span> (from the pricing
                playbook), using its recent sales, returns, FBA stock and last price change:
              </p>
              <ul className="ml-4 list-disc space-y-1">
                <li><span className="text-emerald-700">🟢 creep ↑</span> — selling well (≥3 in 7 days), low returns, stock to spare → nudge the price up. Small £0.30 step inside the tested band or after a prior creep, else £0.50.</li>
                <li><span className="text-emerald-700">🟢 drop ↓</span> — no sale for ≥8 days with stock sitting → cut to get it moving (£0.50, or £1.00 once ≥14 days dead).</li>
                <li><span className="text-emerald-700">🟢 revert ↺</span> — a recent price rise that sold nothing → put it back to where it was selling.</li>
                <li><span className="text-amber-700">🟡 review</span> — a move is suggested but it&apos;s a judgment call (high returns, would cross the segment ceiling or floor, or contradictory signals). Worth a look before applying.</li>
                <li><span className="text-slate-500">⚪ hold</span> — nothing to do yet (just changed, out of stock, thin stock, or steady).</li>
              </ul>
              <p>The <span className="font-medium">why</span> text on each row is the specific trigger that fired. Nothing is applied automatically — each one is a recommendation to accept or override.</p>
            </div>
          </details>

          <SkuTable rows={rows} showSegment={segment === null} applied={applied} onApply={handleApply} />
        </>
      )}
    </AppShell>
  );
}

function Chip({ label, attention, count, active, onClick }: { label: string; attention: number; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ' +
        (active ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50')
      }
    >
      <span className="font-medium">{label}</span>
      {attention > 0
        ? <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">{attention}</span>
        : <span className="text-xs text-slate-400">{count}</span>}
    </button>
  );
}

type ApplyFn = (row: AmzSkuRow, price: number, note: string) => Promise<boolean>;

function SkuTable({ rows, showSegment, applied, onApply }: { rows: AmzSkuRow[]; showSegment: boolean; applied: Record<string, AppliedItem>; onApply: ApplyFn }) {
  const { logout } = useAuth();
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, AmzSkuDetail>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // code currently being applied (row Apply button spinner)
  const colCount = showSegment ? 9 : 8;

  // Wrap the page's apply so the row button can show a brief spinner.
  async function apply(row: AmzSkuRow, price: number, note: string): Promise<boolean> {
    setBusy(row.code);
    const ok = await onApply(row, price, note);
    setBusy(null);
    return ok;
  }

  // Lazily load the drill the first time a row is opened; cache it for the session.
  useEffect(() => {
    if (!openCode || cache[openCode] || loadingCode === openCode) return;
    (async () => {
      setLoadingCode(openCode);
      const res = await getAmzSku(openCode);
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (res.success && res.data) setCache((c) => ({ ...c, [openCode]: res.data as AmzSkuDetail }));
      setLoadingCode(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCode]);

  // No overflow wrapper on the table: an overflow-x ancestor becomes the scroll container and stops the sticky header pinning to the
  // page. The table fits the reading column on desktop; on a narrow screen the page scrolls horizontally instead.
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        {/* Sticky header so the columns stay labelled while you scroll the list. */}
        <thead className="sticky top-0 z-10 text-left text-xs uppercase tracking-wide text-slate-500 shadow-sm">
          <tr className="bg-slate-100">
            <th className="bg-slate-100 px-3 py-2 font-medium">SKU (size)</th>
            {showSegment && <th className="bg-slate-100 px-3 py-2 font-medium">Segment</th>}
            <th className="bg-slate-100 px-3 py-2 text-right font-medium">Price</th>
            <th className="bg-slate-100 px-3 py-2 font-medium">Suggested move</th>
            <th className="bg-slate-100 px-3 py-2 text-right font-medium" title="FBA stock sellable now (+ inbound)">FBA</th>
            <th className="bg-slate-100 px-3 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>
            <th className="bg-slate-100 px-3 py-2 text-right font-medium" title="Units sold, last 14 days">14d</th>
            <th className="bg-slate-100 px-3 py-2 text-right font-medium" title="Return rate, last 14 days">ret%</th>
            <th className="bg-slate-100 px-3 py-2 text-right font-medium">last sold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const t = TIER[r.suggestion.tier];
            const open = openCode === r.code;
            return (
              <Fragment key={r.code}>
                <tr
                  onClick={() => setOpenCode(open ? null : r.code)}
                  className={'cursor-pointer hover:bg-slate-50 ' + (open ? 'bg-slate-50' : t.row)}
                >
                  <td className="px-3 py-2">
                    <ChevronRightIcon className={'mr-1 inline h-3.5 w-3.5 text-slate-400 transition-transform ' + (open ? 'rotate-90' : '')} />
                    <span className="font-mono text-xs text-slate-600">{r.code}</span>
                    {r.title && <span className="ml-2 text-xs text-slate-400">{r.title}</span>}
                  </td>
                  {showSegment && <td className="px-3 py-2 text-xs text-slate-500">{r.segment}</td>}
                  {/* Price — with an optimistic old→new when this SKU is queued (amzfeed still shows the old price till the overnight refresh). */}
                  <td className="px-3 py-2 text-right font-medium text-slate-800">
                    {applied[r.code]
                      ? <span><span className="text-xs text-slate-400 line-through">{money(applied[r.code].old_price)}</span> {money(applied[r.code].new_price)}</span>
                      : money(r.current_price)}
                  </td>
                  {/* Suggested move + Apply. When queued, collapses to a "queued" pill; the plain-English "why" stays as the note. */}
                  <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
                    {applied[r.code] ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">✓ queued → {money(applied[r.code].new_price)}</span>
                    ) : r.suggestion.action === 'hold' ? (
                      <span className="text-xs text-slate-400">{t.dot} {r.suggestion.why}</span>
                    ) : (
                      <div className="min-w-[13rem]">
                        <div className="flex items-center gap-2">
                          <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + t.badge}>{t.dot} {ACTION_LABEL[r.suggestion.action]}</span>
                          {r.suggestion.target !== null && (
                            <span className="font-semibold text-slate-800">→ {money(r.suggestion.target)}</span>
                          )}
                          {r.suggestion.target !== null && (
                            <button
                              type="button"
                              disabled={busy === r.code}
                              onClick={() => apply(r, r.suggestion.target as number, r.suggestion.why)}
                              className="rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {busy === r.code ? '…' : 'Apply'}
                            </button>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-slate-500">{r.suggestion.why}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    <span className={r.fba_live === 0 ? 'text-slate-300' : ''}>{r.fba_live}</span>
                    {r.fba_inbound > 0 && <span className="text-xs text-slate-400"> +{r.fba_inbound}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{r.sold_7d || <span className="text-slate-300">0</span>}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{r.sold_14d || <span className="text-slate-300">0</span>}</td>
                  <td className={'px-3 py-2 text-right ' + (r.sold_14d > 0 && r.return_rate >= 0.4 ? 'font-medium text-amber-700' : 'text-slate-500')}>
                    {r.sold_14d > 0 ? `${Math.round(r.return_rate * 100)}%` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-slate-500">
                    {r.last_sold ? fmtDate(r.last_sold) : <span className="text-amber-700">never</span>}
                  </td>
                </tr>

                {open && (
                  <tr>
                    <td colSpan={colCount} className="border-t border-slate-200 bg-slate-50/70 px-4 py-4">
                      {loadingCode === r.code || !cache[r.code]
                        ? <p className="text-xs text-slate-400">Loading detail…</p>
                        : <SkuDrill detail={cache[r.code]} row={r} queued={applied[r.code]} onApply={apply} busy={busy === r.code} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// The dig-deeper panel for one SKU: 6-week velocity, price-change history (with the reasoning notes), and the sold-price bands
// (the resistance guardrail). Read-only — this is the evidence for a decision, not the decision.
function SkuDrill({ detail, row, queued, onApply, busy }: { detail: AmzSkuDetail; row: AmzSkuRow; queued?: AppliedItem; onApply: ApplyFn; busy: boolean }) {
  const maxWeek = Math.max(1, ...detail.weeks.map((w) => w.units));
  const maxBand = Math.max(1, ...detail.bands.map((b) => b.units));

  // The "decide" box — set any price (pre-filled with the suggested target), with an optional note. This is where a considered or
  // custom move happens (e.g. "the creep held, try a little higher"), as opposed to the one-click Apply in the row.
  const [price, setPrice] = useState<string>(row.suggestion.target !== null ? String(row.suggestion.target) : (row.current_price !== null ? String(row.current_price) : ''));
  const [note, setNote] = useState<string>('');
  const priceNum = Number(price);
  const canApply = Number.isFinite(priceNum) && priceNum > 0 && !busy;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white px-3 py-2">
        <label className="text-xs text-slate-500">
          <span className="mb-0.5 block font-medium text-slate-600">Set price</span>
          <span className="flex items-center">
            <span className="mr-1 text-slate-400">£</span>
            <input
              type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)}
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </span>
        </label>
        <label className="min-w-[12rem] flex-1 text-xs text-slate-500">
          <span className="mb-0.5 block font-medium text-slate-600">Note <span className="font-normal text-slate-400">(optional — defaults to the reason)</span></span>
          <input
            type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={row.suggestion.why}
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <button
          type="button" disabled={!canApply}
          onClick={() => onApply(row, Math.round(priceNum * 100) / 100, note.trim() || row.suggestion.why)}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Applying…' : queued ? 'Update queued price' : 'Apply price'}
        </button>
        {queued && <span className="text-xs text-emerald-700">✓ queued → {money(queued.new_price)}</span>}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {/* 1) 6-week velocity — the trend. A halving week-on-week is the act-now signal. */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Velocity — 6 weeks</h4>
        <div className="flex items-end gap-1.5" style={{ height: 72 }}>
          {detail.weeks.map((w) => (
            <div key={w.week_start} className="flex flex-1 flex-col items-center justify-end" title={`${w.units} sold · ${w.returns} returned · avg ${w.avg_price !== null ? '£' + w.avg_price.toFixed(2) : '—'}`}>
              <span className="mb-0.5 text-[10px] font-medium text-slate-600">{w.units}</span>
              <div className="w-full rounded-t bg-emerald-400" style={{ height: Math.round((w.units / maxWeek) * 48) }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {detail.weeks.map((w) => (
            <span key={w.week_start} className="flex-1 text-center text-[10px] text-slate-400">{fmtShort(w.week_start)}</span>
          ))}
        </div>
        {detail.weeks.some((w) => w.returns > 0) && (
          <p className="mt-1 text-[10px] text-slate-400">returns/wk: {detail.weeks.map((w) => w.returns).join(' · ')}</p>
        )}
      </div>

      {/* 2) Price bands — units at each price over 60 days. Where units thin out is the discovered ceiling. */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Units by price — 60 days</h4>
        {detail.bands.length === 0 ? (
          <p className="text-xs text-slate-400">No sales in the last 60 days.</p>
        ) : (
          <div className="space-y-1">
            {detail.bands.map((b, i) => {
              const isCurrent = row.current_price !== null && b.price === row.current_price;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className={'w-14 shrink-0 text-right text-xs tabular-nums ' + (isCurrent ? 'font-semibold text-slate-800' : 'text-slate-500')}>
                    {money(b.price)}
                  </span>
                  <div className="h-3.5 flex-1 rounded bg-slate-100">
                    <div className={'h-3.5 rounded ' + (isCurrent ? 'bg-brand-500' : 'bg-slate-300')} style={{ width: `${Math.round((b.units / maxBand) * 100)}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-xs tabular-nums text-slate-600">{b.units}</span>
                </div>
              );
            })}
            <p className="pt-1 text-[10px] text-slate-400">
              blue = current price{row.suggestion.target !== null ? ` · suggested → ${money(row.suggestion.target)}` : ''}. Units drying up above a price = resistance.
            </p>
          </div>
        )}
      </div>

      {/* 3) Price history — the last few moves and, crucially, the note that captured the reasoning. */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Price history</h4>
        {detail.history.length === 0 ? (
          <p className="text-xs text-slate-400">No logged price changes.</p>
        ) : (
          <ul className="space-y-2">
            {detail.history.map((h, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">{fmtShort(h.log_date)}</span>
                  <span className="text-slate-500">{money(h.old_price)}</span>
                  <span className={h.direction === 'creep' ? 'text-emerald-600' : h.direction === 'drop' ? 'text-amber-600' : 'text-slate-400'}>→</span>
                  <span className="font-medium text-slate-800">{money(h.new_price)}</span>
                </div>
                {h.notes && <p className="mt-0.5 leading-snug text-slate-500">{h.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>
    </>
  );
}
