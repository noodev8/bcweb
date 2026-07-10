'use client';
/*
=======================================================================================================================================
Component: AmzHistory
=======================================================================================================================================
Purpose: A reference report on the Amazon drill — recent PRICE CHANGES for this SKU (old->new, direction, note), from the amz_price_log
         audit table. Collapsible and DEFAULT HIDDEN; it LAZY-loads (GET /amz-history only the first time it's opened) so the initial
         drill stays fast. Bounded by most-recent-N rows; newest first. The note is where the reasoning of the last move lives — the most
         useful thing to see before the next one. (Mirror of the Shopify PriceHistory; amz_price_log has no "changed_by" column yet.)
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { getAmzHistory, AmzHistoryRow } from '@/lib/api';
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

export default function AmzHistory({ code }: { code: string }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AmzHistoryRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [limit, setLimit] = useState(0);

  async function load() {
    setLoading(true);
    setError(null);
    const res = await getAmzHistory(code);
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

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) await load();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={toggle} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-700">
        <span>Price history <span className="font-normal text-slate-400">— recent Amazon price changes</span></span>
        {open ? <ChevronDownIcon className="h-4 w-4 text-slate-400" /> : <ChevronRightIcon className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loading && <p className="text-sm text-slate-400">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-400">No price changes logged for this SKU yet.</p>
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
                      const up = r.direction === 'creep';
                      const down = r.direction === 'drop';
                      const arrow = up ? '↑' : down ? '↓' : '→';
                      const tone = up ? 'text-green-700' : down ? 'text-amber-700' : 'text-slate-600';
                      return (
                        <tr key={i}>
                          <td className="whitespace-nowrap py-1.5 pr-4 text-slate-600">{fmtDate(r.log_date)}</td>
                          <td className={'whitespace-nowrap py-1.5 pr-4 tabular-nums ' + tone}>
                            {money(r.old_price)} <span className="px-0.5">{arrow}</span> <span className="font-semibold">{money(r.new_price)}</span>
                          </td>
                          <td className="py-1.5 pr-4 text-slate-600">{r.notes || <span className="text-slate-300">—</span>}</td>
                          <td className="whitespace-nowrap py-1.5 text-slate-500">{r.changed_by || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {truncated && <p className="mt-3 text-xs text-slate-400">Showing the last {limit} changes.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
