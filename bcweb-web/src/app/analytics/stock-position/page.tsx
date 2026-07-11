'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-position  (Analytics module — Stock Position)
=======================================================================================================================================
Purpose: A "living catalogue" gauge — how many products are commercially ALIVE right now, tracked over time so we can watch the
         inventory grow (and see it speed up / slow down) as the business grows. Kept SEPARATELY per channel, because a Shopify product
         and an Amazon product are different things:
           - Shopify counts STYLES (skusummary.groupid, live = shopify=1).
           - Amazon  counts SKUs   (amzfeed.code — one row per size).

         Each product falls into one of four buckets (they sum to the channel's universe):
           - In stock + selling   (in stock now AND sold in last 6 months)   )
           - In stock, quiet      (in stock now, no sale in 6 months)        )  ALIVE = the living catalogue
           - Sold, now empty      (out of stock but sold in last 6 months)   )
           - Dormant              (no stock AND no sale in 6 months)         -> NOT alive; the "gone quiet" pile to triage later.

         Snapshot-on-view: just loading this page takes today's reading and stores it (GET /analytics-stock-position upserts today's
         rows), so visiting "now and again" quietly builds the trend — no cron, no Update button.

Guarded by AppShell. Consumes GET /analytics-stock-position.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { getStockPosition, updateStockPosition, StockPositionRow } from '@/lib/api';

// Bucket display metadata (shared by the panels' stacked bar + breakdown). Order = healthiest -> not alive.
const BUCKETS = [
  { key: 'in_stock_selling', label: 'In stock + selling', color: '#059669', desc: 'in stock now, sold in last 6 months' },
  { key: 'in_stock_no_sale', label: 'In stock, quiet', color: '#d97706', desc: 'in stock but no sale in 6 months' },
  { key: 'oos_sold_recently', label: 'Sold, now empty', color: '#0284c7', desc: 'out of stock but sold in last 6 months' },
  { key: 'dormant', label: 'Dormant', color: '#94a3b8', desc: 'no stock and no sale in 6 months — gone quiet' },
] as const;

export default function StockPositionPage() {
  const { logout } = useAuth();
  const [shp, setShp] = useState<StockPositionRow | null>(null);
  const [amz, setAmz] = useState<StockPositionRow | null>(null);
  const [histShp, setHistShp] = useState<StockPositionRow[]>([]);
  const [histAmz, setHistAmz] = useState<StockPositionRow[]>([]);
  const [asOf, setAsOf] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getStockPosition(90);
    if (res.success && res.data) {
      setShp(res.data.today.shp);
      setAmz(res.data.today.amz);
      setHistShp(res.data.history.shp);
      setHistAmz(res.data.history.amz);
      setAsOf(res.data.today.shp?.date || '');
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Stock Position');
    }
    setLoading(false);
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  async function onUpdate() {
    setUpdating(true);
    setNotice(null);
    setError(null);
    const res = await updateStockPosition();
    if (res.success && res.data) {
      const { shp: s, amz: a } = res.data.today;
      setNotice(`Snapshot recorded — Shopify ${s.alive} alive of ${s.total}, Amazon ${a.alive} alive of ${a.total}.`);
      await load();
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to record snapshot');
    }
    setUpdating(false);
  }

  return (
    <AppShell title="Stock Position" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        The <strong>living catalogue</strong> — how many products are commercially alive right now, not the raw row count. A product is
        counted as <strong>alive</strong> if it is active in our database and either <strong>in stock now</strong> or has <strong>sold
        in the last 6 months</strong>; everything else is <strong>dormant</strong> (gone quiet — a pile to price, restock, remove or
        park later). Shopify counts <strong>styles</strong>; Amazon counts <strong>SKUs</strong> — different things, tracked apart.
        The figures below are always live; hit <em>Update now</em> to record today&apos;s reading onto the trend (one snapshot per day).
      </p>

      {notice && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && shp && amz && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChannelPanel title="Shopify" unit="styles" row={shp} />
            <ChannelPanel title="Amazon" unit="SKUs" row={amz} />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={onUpdate}
              disabled={updating}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updating ? 'Recording…' : 'Update now'}
            </button>
            {asOf && <span className="text-xs text-slate-400">Live as of {asOf}</span>}
          </div>

          {(histShp.length > 1 || histAmz.length > 1) ? (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-medium text-slate-600">Alive over time</h2>
              <AliveChart shp={histShp} amz={histAmz} />
            </div>
          ) : (
            <p className="mt-6 text-sm text-slate-400">
              Trend starts once there are at least two readings — check back another day to see it move.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}

// One channel card: big ALIVE number, the universe + dormant context, a stacked composition bar, and the four-bucket breakdown.
function ChannelPanel({ title, unit, row }: { title: string; unit: string; row: StockPositionRow }) {
  const total = row.total || 1;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums text-brand-600">{row.alive}</span>
            <span className="text-sm text-slate-400">alive {unit}</span>
          </div>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>of <span className="font-medium tabular-nums text-slate-700">{row.total}</span> total</div>
          <div className="text-slate-400"><span className="tabular-nums">{row.dormant}</span> dormant</div>
        </div>
      </div>

      {/* Composition bar — the four buckets to scale across the universe. */}
      <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {BUCKETS.map((b) => {
          const v = row[b.key];
          const pct = (v / total) * 100;
          return v > 0 ? (
            <div key={b.key} style={{ width: `${pct}%`, backgroundColor: b.color }} title={`${b.label}: ${v}`} />
          ) : null;
        })}
      </div>

      {/* Breakdown rows. */}
      <ul className="space-y-1.5">
        {BUCKETS.map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ backgroundColor: b.color }} />
            <span className="text-slate-700">{b.label}</span>
            <span className="text-xs text-slate-400">— {b.desc}</span>
            <span className="ml-auto font-medium tabular-nums text-slate-900">{row[b.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Alive-over-time: two lines (Shopify + Amazon) on a shared count axis. Lightweight inline SVG, no chart lib.
function AliveChart({ shp, amz }: { shp: StockPositionRow[]; amz: StockPositionRow[] }) {
  const W = 720, H = 220, padL = 34, padR = 16, padT = 12, padB = 24;
  // Shared x-axis over the union of dates present (both channels are snapshotted together, so their dates line up).
  const dates = Array.from(new Set([...shp, ...amz].map((r) => r.date))).sort();
  const n = dates.length;
  const idx = (d: string) => dates.indexOf(d);
  const maxY = Math.max(1, ...shp.map((r) => r.alive), ...amz.map((r) => r.alive));
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const line = (rows: StockPositionRow[]) => rows.map((r) => `${x(idx(r.date))},${y(r.alive)}`).join(' ');

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-brand-600" /> Shopify alive</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded" style={{ backgroundColor: '#7c3aed' }} /> Amazon alive</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 460 }} role="img" aria-label="Alive products over time by channel">
        {[0, Math.round(maxY / 2), maxY].map((v) => (
          <g key={`g${v}`}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#f1f5f9" />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          </g>
        ))}
        {/* x-axis date labels — ~6 evenly spaced. */}
        {dates.map((d, i) => {
          const step = Math.max(1, Math.ceil(n / 6));
          if (i % step !== 0 && i !== n - 1) return null;
          const dt = new Date(d);
          const lbl = `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
          return <text key={`x${d}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{lbl}</text>;
        })}
        <polyline points={line(amz)} fill="none" stroke="#7c3aed" strokeWidth={2} />
        {amz.map((r) => (
          <circle key={`a${r.date}`} cx={x(idx(r.date))} cy={y(r.alive)} r={2} fill="#7c3aed">
            <title>{`${r.date}: ${r.alive} alive / ${r.total} total (Amazon)`}</title>
          </circle>
        ))}
        <polyline points={line(shp)} fill="none" stroke="#0284c7" strokeWidth={2} />
        {shp.map((r) => (
          <circle key={`s${r.date}`} cx={x(idx(r.date))} cy={y(r.alive)} r={2} fill="#0284c7">
            <title>{`${r.date}: ${r.alive} alive / ${r.total} total (Shopify)`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
