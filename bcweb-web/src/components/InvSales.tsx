'use client';
/*
=======================================================================================================================================
Component: InvSales
=======================================================================================================================================
Purpose: "Is this actually selling, what for, and did we make anything on it" — the last N sales of one style, on the Inventory panel,
         so the operator can answer a customer's question without changing screens (owner, 2026-07-20).

COLLAPSED BY DEFAULT AND LAZILY FETCHED. The common use of this screen is "have we got a 39", which this does not help with — so it
costs nothing until it is opened. Same pattern as the pricing drill's report sections.

ALL CHANNELS IN ONE FEED, no toggle. There are three live channels (SHP, AMZ and CM3), so a Shopify/Amazon switch would have hidden
CM3 entirely; and on this screen the question is whether the product moves at all, not how it moved per channel. The channel rides on
each row as a small chip instead. See routes/inv-sales.js.

RETURNS ARE SHOWN, flagged, and struck through — never hidden. A return sitting in the recent-sales list is exactly the thing you want
to notice about a product; a list that quietly dropped them would overstate how well it is doing.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import { getInvSales, InvSaleRow } from '@/lib/api';

// Channel chips. Muted on purpose: the channel is context for the row, not its headline — the price and profit are.
const CHANNEL_STYLES: Record<string, string> = {
  SHP: 'bg-emerald-50 text-emerald-700',
  AMZ: 'bg-amber-50 text-amber-700',
  CM3: 'bg-violet-50 text-violet-700',
};

// "18 Jul" — short, because the year is noise on a most-recent-5 list where everything is within weeks.
function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);

export default function InvSales({ groupid }: { groupid: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<InvSaleRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getInvSales(groupid, 5);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setTruncated(res.data.truncated);
    } else {
      setError(res.error || 'Could not load sales');
    }
    setLoading(false);
  }, [groupid]);

  // Fetch on first open only. The parent re-keys this component per style, so switching product resets to collapsed+unfetched.
  useEffect(() => {
    if (open && rows === null && !loading) load();
  }, [open, rows, loading, load]);

  return (
    <div className="border-t border-slate-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
      >
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Recent sales</span>
        <span className="text-xs text-slate-400">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading && <div className="py-3 text-center text-sm text-slate-400">Loading…</div>}
          {error && <div className="py-3 text-center text-sm text-rose-600">{error}</div>}

          {rows !== null && rows.length === 0 && !loading && (
            <div className="py-3 text-center text-sm text-slate-400">No sales recorded for this style.</div>
          )}

          {rows !== null && rows.length > 0 && (
            <>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="py-1.5 pr-3 font-medium">Date</th>
                    <th className="py-1.5 pr-3 font-medium">Ch</th>
                    <th className="py-1.5 pr-3 font-medium">Size</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Price</th>
                    <th className="py-1.5 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r, i) => (
                    <tr key={i} className={r.isReturn ? 'text-slate-400' : ''}>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-600">
                        {shortDate(r.solddate)}
                        {r.ordertime && <span className="ml-1.5 text-xs text-slate-400">{r.ordertime}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.channel && (
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${CHANNEL_STYLES[r.channel] || 'bg-slate-100 text-slate-600'}`}>
                            {r.channel}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-slate-700">
                        {r.sizeDisplay || '—'}
                        {/* A return is called a return in words, not just implied by the strikethrough — colour and line-through
                            alone are too easy to miss on a quick glance, and misreading one as a sale is the error that matters. */}
                        {r.isReturn && (
                          <span className="ml-1.5 rounded bg-rose-50 px-1 py-0.5 text-[10px] font-medium text-rose-700">Return</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.qty}</td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${r.isReturn ? 'line-through' : 'text-slate-700'}`}>
                        {money(r.soldprice)}
                      </td>
                      {/* Profit is the one number here that can be NEGATIVE and must never be misread as positive — a loss is
                          coloured, not just signed. */}
                      <td
                        className={`py-1.5 text-right font-medium tabular-nums ${
                          r.profit === null ? 'text-slate-300' : r.profit < 0 ? 'text-rose-600' : 'text-slate-800'
                        }`}
                      >
                        {money(r.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated && (
                <div className="pt-2 text-right text-xs text-slate-400">Showing the last {rows.length} sales</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
