'use client';
/*
=======================================================================================================================================
Component: PriceHistory
=======================================================================================================================================
Purpose: A reference report on the drill screen — recent Shopify PRICE CHANGES for this style (old->new, note, who, when), from the
         price_change_log audit table. Collapsible and DEFAULT HIDDEN; it LAZY-loads (fetches GET /pricing-history only the first time
         it's opened) so the initial drill stays fast (owner decision). Bounded by most-recent-N rows: when more exist, a "showing last N"
         note is shown. Newest first — the last decision is at the top, which is what you want to see before making the next one.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getPriceHistory, PriceHistoryRow } from '@/lib/api';
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

export default function PriceHistory({ groupid }: { groupid: string }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);   // have we fetched at least once?
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PriceHistoryRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      setError(null);
      const res = await getPriceHistory(groupid);
      setLoading(false);
      if (res.success && res.data) {
        setRows(res.data.rows);
        setTruncated(res.data.truncated);
        setLimit(res.data.limit);
        setLoaded(true);
      } else {
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load price history');
      }
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700"
      >
        <span>Price history <span className="font-normal text-slate-400">— recent Shopify price changes</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No price changes logged for this style yet.</p>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">Date</th>
                      <th className="py-1.5 pr-4 font-medium">Change</th>
                      <th className="py-1.5 pr-4 font-medium">Note</th>
                      <th className="py-1.5 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => {
                      const up = r.old_price !== null && r.new_price !== null && r.new_price > r.old_price;
                      const down = r.old_price !== null && r.new_price !== null && r.new_price < r.old_price;
                      const arrow = up ? '↑' : down ? '↓' : '→';
                      const tone = up ? 'text-green-700' : down ? 'text-amber-700' : 'text-slate-600';
                      return (
                        <tr key={i}>
                          <td className="whitespace-nowrap py-1.5 pr-4 text-slate-600">{fmtDate(r.change_date)}</td>
                          <td className={'whitespace-nowrap py-1.5 pr-4 tabular-nums ' + tone}>
                            {money(r.old_price)} <span className="px-0.5">{arrow}</span> <span className="font-semibold">{money(r.new_price)}</span>
                          </td>
                          <td className="py-1.5 pr-4 text-slate-600">{r.note || <span className="text-slate-300">—</span>}</td>
                          <td className="whitespace-nowrap py-1.5 text-slate-500">{r.changed_by || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {truncated && (
                <p className="mt-3 text-xs text-slate-400">Showing the last {limit} changes.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
