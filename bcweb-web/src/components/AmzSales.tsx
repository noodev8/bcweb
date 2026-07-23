'use client';
/*
=======================================================================================================================================
Component: AmzSales
=======================================================================================================================================
Purpose: A reference report on the Amazon drill — the recent RAW Amazon sales of this SKU, one row per sale line, each with the price it
         actually SOLD at. The velocity/bands views aggregate these; this is the granular view underneath. Collapsible, DEFAULT HIDDEN,
         LAZY-loads (GET /amz-sales on first open). Bounded by most-recent-N rows; newest first. Sold lines only — returns are excluded
         server-side (noise for pricing intent, owner decision). Mirror of the Shopify SalesList — including its preview: the table shows
         the first PREVIEW_ROWS (10) and RowsToggle reveals the rest of the loaded rows on one click, so a hot SKU doesn't bury the page.
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
// DEFAULT OPEN on the drill (mirrors the Shopify SalesList's `defaultOpen`, owner, 2026-07-23): recent sales is the report the operator
// goes straight to, so it starts expanded and fetches on mount rather than waiting for a click.
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getAmzSales, AmzSaleRow } from '@/lib/api';
import RowsToggle, { PREVIEW_ROWS } from '@/components/RowsToggle';
import { useAuth } from '@/contexts/AuthContext';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

export default function AmzSales({ code, defaultOpen = false }: { code: string; defaultOpen?: boolean }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AmzSaleRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);
  const [showAll, setShowAll] = useState(false);   // preview (10) vs the whole loaded list; reset on every fetch

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getAmzSales(code);
    setLoading(false);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setTruncated(res.data.truncated);
      setLimit(res.data.limit);
      setShowAll(false);
      setLoaded(true);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load sales');
    }
  }

  // Auto-load when it starts open (defaultOpen). Guarded so it fires once.
  useEffect(() => {
    if (open && !loaded && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) await load();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={toggle} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700">
        <span>Recent sales <span className="font-normal text-slate-400">— individual Amazon sale lines</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No Amazon sales recorded for this SKU.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Date</th>
                      <th className="py-1.5 pr-4 font-medium">Size</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Qty</th>
                      <th className="py-1.5 pr-4 text-right font-medium">Sold at</th>
                      <th className="py-1.5 text-right font-medium">Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(showAll ? rows : rows.slice(0, PREVIEW_ROWS)).map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap py-1.5 pr-4 text-slate-600">{fmtDate(r.solddate)}</td>
                        <td className="py-1.5 pr-4 font-mono text-xs text-slate-500">{r.size || '—'}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-700">{r.qty}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-slate-700">{money(r.soldprice)}</td>
                        <td className={`py-1.5 text-right font-semibold tabular-nums ${r.profit === null ? 'text-slate-400' : r.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{money(r.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RowsToggle total={rows.length} showingAll={showAll} onToggle={() => setShowAll((v) => !v)} />
              {truncated && showAll && (
                <p className="mt-3 text-xs text-slate-400">The last {limit} sales only — older ones aren&apos;t loaded.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
