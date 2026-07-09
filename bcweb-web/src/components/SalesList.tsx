'use client';
/*
=======================================================================================================================================
Component: SalesList
=======================================================================================================================================
Purpose: A reference report on the drill screen — recent RAW Shopify SALES for this style, one row per sale line with the price it sold
         at (date, size, qty, sold price). The pricing timeline above aggregates these by price; this is the granular view beneath it.
         Collapsible and DEFAULT HIDDEN; LAZY-loads (GET /pricing-sales only on first open) to keep the initial drill fast. Bounded by
         most-recent-N rows (sales are dense on a hot style) — when more exist, a "showing last N" note appears. Newest first.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getSales, SaleRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

export default function SalesList({ groupid }: { groupid: string }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      setError(null);
      const res = await getSales(groupid);
      setLoading(false);
      if (res.success && res.data) {
        setRows(res.data.rows);
        setTruncated(res.data.truncated);
        setLimit(res.data.limit);
        setLoaded(true);
      } else {
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load sales');
      }
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700"
      >
        <span>Recent sales <span className="font-normal text-slate-400">— individual sales &amp; the price each sold at</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No Shopify sales recorded for this style.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Date</th>
                      <th className="py-1.5 pr-4 font-medium">Size</th>
                      <th className="py-1.5 text-right font-medium">Sold at</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap py-1.5 pr-4 text-slate-600">
                          {fmtDate(r.solddate)}{r.ordertime ? <span className="text-slate-400"> {r.ordertime}</span> : null}
                        </td>
                        <td className="py-1.5 pr-4 font-mono text-slate-600">{r.size || '—'}</td>
                        <td className="py-1.5 text-right font-semibold tabular-nums text-slate-800">{money(r.soldprice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {truncated && (
                <p className="mt-3 text-xs text-slate-400">Showing the last {limit} sales.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
