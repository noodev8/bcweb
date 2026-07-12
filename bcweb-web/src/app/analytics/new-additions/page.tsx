'use client';
/*
=======================================================================================================================================
Page: /analytics/new-additions  (Analytics module — New Additions)
=======================================================================================================================================
Purpose: The catalogue-GROWTH pulse. How many Shopify styles were ADDED in the recent window (default: last 30 days), and how each new
         addition is doing — units sold, revenue and profit so far (lifetime ≈ since-add, as these are brand-new products). Loading it
         now and again tells the owner whether the month brought a lot of new product or a little, and whether the new lines sell.

         HERO number = count of new styles in the window (the thing being monitored). A small window toggle (30 / 60 / 90 days) lets the
         lens widen. Below, a table of the additions themselves, newest-created first.

Guarded by AppShell. Consumes GET /analytics-new-additions.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { getNewAdditions, NewAdditionRow } from '@/lib/api';

const DAYS = 30; // fixed window (owner decision — no lens toggle)

export default function NewAdditionsPage() {
  const { logout } = useAuth();
  const [copied, setCopied] = useState<string | null>(null); // groupid just copied (brief flash)
  const [rows, setRows] = useState<NewAdditionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getNewAdditions(DAYS);
    if (res.success && res.data) {
      setRows(res.data.rows);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load New Additions');
    }
    setLoading(false);
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  // Totals across the additions — a quick read of how much the new lines have contributed.
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };
  // Click a row to copy its groupid to the clipboard (paste into Add / Modify search). Brief "Copied" flash on the row.
  const copyGroupid = async (groupid: string) => {
    try {
      await navigator.clipboard.writeText(groupid);
      setCopied(groupid);
      setTimeout(() => setCopied((c) => (c === groupid ? null : c)), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  // Whole days between the creation date and today — how long the line has been live.
  const daysLive = (d: string | null) => {
    if (!d) return null;
    const ms = Date.now() - new Date(d).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };
  return (
    <AppShell title="New Additions" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        Styles <strong>added in the last {DAYS} days</strong>, newest first — and how each new line has sold so far (all channels). A quick
        read on whether the month brought a lot of new product or a little.
      </p>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* HERO — how many new styles this window. Supporting sales totals demoted beside it. */}
          <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">New styles</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{rows.length}</span>
              </div>
            </div>
            <div className="flex gap-8 border-l border-slate-200 pl-8 text-sm">
              <Stat label="Units sold" value={String(totalUnits)} />
              <Stat label="Revenue" value={money(totalRevenue)} />
              <Stat label="Profit" value={money(totalProfit)} />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No styles were added in the last {DAYS} days.</p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Added</th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 text-right font-medium">RRP</th>
                    <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                    <th className="px-3 py-2.5 text-right font-medium">Sold</th>
                    <th className="px-3 py-2.5 text-right font-medium">Revenue</th>
                    <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.groupid}
                      onClick={() => copyGroupid(r.groupid)}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      title="Click to copy groupid"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                        {fmtDate(r.created)}
                        {daysLive(r.created) !== null && (
                          <span className="ml-2 text-xs text-slate-400">{daysLive(r.created)}d</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {r.title || <span className="text-slate-400">Untitled</span>}
                        <span className="ml-2 text-xs text-slate-400">{r.groupid}</span>
                        {copied === r.groupid && <span className="ml-2 text-xs font-medium text-brand-600">Copied</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.rrp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.stock}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.revenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-700">{value}</div>
    </div>
  );
}
