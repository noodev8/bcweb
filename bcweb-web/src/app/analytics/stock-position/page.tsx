'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-position  (Analytics module — Stock Position)
=======================================================================================================================================
Purpose: A "active catalogue" gauge — how many products are commercially ALIVE right now, tracked over time so we can watch the
         inventory grow (and see it speed up / slow down) as the business grows. Kept SEPARATELY per channel, because a Shopify product
         and an Amazon product are different things:
           - Shopify counts STYLES (skusummary.groupid, live = shopify=1).
           - Amazon  counts SKUs   (amzfeed.code — one row per size).

         Each product falls into one of four buckets (they sum to the channel's universe):
           - In stock + selling   (in stock now AND sold in last 12 months)  )
           - In stock, quiet      (in stock now, no sale in 12 months)       )  ALIVE = the active catalogue
           - Sold, now empty      (out of stock but sold in last 12 months)  )
           - Dormant              (no stock AND no sale in 12 months)        -> NOT alive; the "gone quiet" pile to triage later.

         Snapshot-on-view: just loading this page takes today's reading and stores it (GET /analytics-stock-position upserts today's
         rows), so visiting "now and again" quietly builds the trend — no cron, no Update button.

Guarded by AppShell. Consumes GET /analytics-stock-position.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import {
  getStockPosition, updateStockPosition, getStockPositionList,
  StockPositionRow, StockListItem, StockBucket,
} from '@/lib/api';

// Bucket display metadata (shared by the panels' bar + breakdown). Order = healthiest -> not alive.
const BUCKETS = [
  { key: 'in_stock_selling', label: 'In stock + selling', color: '#059669', desc: 'in stock now, sold in last 12 months' },
  { key: 'in_stock_no_sale', label: 'In stock, quiet', color: '#d97706', desc: 'in stock but no sale in 12 months' },
  { key: 'oos_sold_recently', label: 'Sold, now empty', color: '#0284c7', desc: 'out of stock but sold in last 12 months' },
  { key: 'dormant', label: 'Dormant', color: '#94a3b8', desc: 'no stock and no sale in 12 months — gone quiet' },
] as const;

// The three buckets that make up ALIVE (the active catalogue), and dormant on its own — dormant is NOT part of the alive number, so
// the panel renders it set apart and labelled "excluded" (it was reading as if it were inside the headline).
const ALIVE_BUCKETS = BUCKETS.filter((b) => b.key !== 'dormant');
const DORMANT_BUCKET = BUCKETS.find((b) => b.key === 'dormant')!;

// The "in stock + selling" count from the most recent RECORDED snapshot strictly before today (null if none yet) — for the
// "since last" delta on the hero. `today` is live/unrecorded, so we compare against the newest history point dated earlier than it.
function prevSelling(hist: StockPositionRow[], today: string): number | null {
  const before = hist.filter((r) => r.date < today);
  return before.length ? before[before.length - 1].in_stock_selling : null;
}

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

  // Drill: which bucket (of which channel) is open, and the products behind it.
  const [sel, setSel] = useState<{ channel: 'SHP' | 'AMZ'; bucket: StockBucket } | null>(null);
  const [listRows, setListRows] = useState<StockListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);

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

  // Open (or toggle closed) a bucket's product list.
  const openBucket = useCallback(async (channel: 'SHP' | 'AMZ', bucket: StockBucket) => {
    if (sel && sel.channel === channel && sel.bucket === bucket) { setSel(null); return; }
    setSel({ channel, bucket });
    setListLoading(true);
    setListRows([]);
    const res = await getStockPositionList(channel, bucket);
    if (res.success && res.data) {
      setListRows(res.data.rows);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load list');
    }
    setListLoading(false);
  }, [sel, logout]);

  async function onUpdate() {
    setUpdating(true);
    setNotice(null);
    setError(null);
    const res = await updateStockPosition();
    if (res.success && res.data) {
      const { shp: s, amz: a } = res.data.today;
      setNotice(`Snapshot recorded — Shopify ${s.in_stock_selling} in stock + selling (of ${s.alive} active), Amazon ${a.in_stock_selling} (of ${a.alive} active).`);
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
        The <strong>active catalogue</strong> — products in stock now or sold in the last 12 months. Everything else is dormant, and not
        counted.
      </p>

      {notice && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && shp && amz && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChannelPanel
              title="Shopify" channel="SHP" row={shp} prevSelling={prevSelling(histShp, asOf)}
              selectedBucket={sel?.channel === 'SHP' ? sel.bucket : null} onPick={openBucket}
            />
            <ChannelPanel
              title="Amazon" channel="AMZ" row={amz} prevSelling={prevSelling(histAmz, asOf)}
              selectedBucket={sel?.channel === 'AMZ' ? sel.bucket : null} onPick={openBucket}
            />
          </div>

          {sel && (
            <BucketList
              channel={sel.channel}
              bucket={sel.bucket}
              rows={listRows}
              loading={listLoading}
              onClose={() => setSel(null)}
            />
          )}

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
              <h2 className="mb-2 text-sm font-medium text-slate-600">In stock + selling over time</h2>
              <SellingChart shp={histShp} amz={histAmz} />
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

// One channel card. Deliberate hierarchy: IN STOCK + SELLING is the HERO — the "winning" number (stock you hold that's actually
// converting; growing it grows the business), big and alone at the top. The active catalogue total is only a small frame beside it
// ("of N active"). Everything else — the full bucket composition and dormant — is demoted into a faded detail zone below a divider,
// small and muted, so nothing competes with the number. Detail rows stay clickable to drill. `prevSelling` = the last recorded
// snapshot's in-stock+selling count (null if none yet) → a subtle "since last" delta, since the whole point is watching it move.
function ChannelPanel({
  title, channel, row, prevSelling, selectedBucket, onPick,
}: {
  title: string; channel: 'SHP' | 'AMZ'; row: StockPositionRow; prevSelling: number | null;
  selectedBucket: StockBucket | null; onPick: (channel: 'SHP' | 'AMZ', bucket: StockBucket) => void;
}) {
  const aliveTotal = row.alive || 1;
  const delta = prevSelling === null ? null : row.in_stock_selling - prevSelling;

  // Compact, muted detail row — a drill button. `dim` fades dormant further (it's excluded from the number).
  const renderRow = (b: (typeof BUCKETS)[number], dim = false) => {
    const active = selectedBucket === b.key;
    const count = row[b.key];
    return (
      <li key={b.key}>
        <button
          type="button"
          onClick={() => onPick(channel, b.key)}
          disabled={count === 0}
          className={
            'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] transition ' +
            (count === 0 ? 'cursor-default opacity-50 ' : 'hover:bg-slate-50 ') +
            (active ? 'bg-slate-100 ring-1 ring-slate-200' : '')
          }
        >
          <span className="h-2 w-2 flex-none rounded-sm" style={{ backgroundColor: b.color }} />
          <span className={dim ? 'text-slate-400' : 'text-slate-500'}>{b.label}</span>
          <span className="hidden text-xs text-slate-400 md:inline">— {b.desc}</span>
          <span className={'ml-auto tabular-nums ' + (dim ? 'text-slate-400' : 'font-medium text-slate-700')}>{count}</span>
          {count > 0 && <span className="w-3 text-xs text-slate-300">{active ? '▾' : '›'}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* HERO — the winning number: in stock + selling. Channel label above, a subtle since-last delta beside, and a small active
          -catalogue frame beneath. */}
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{row.in_stock_selling}</span>
        {delta !== null && delta !== 0 && (
          <span
            className={
              'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ' +
              (delta > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')
            }
            title="change in stock + selling since your last recorded snapshot"
          >
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
          </span>
        )}
      </div>

      {/* FADED DETAIL — everything that isn't the headline. Small, muted, below a divider. */}
      <div className="mt-5 border-t border-slate-200 pt-3">
        {/* Slim alive-only bar (proportions within alive). */}
        <div className="mb-2 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          {ALIVE_BUCKETS.map((b) => {
            const v = row[b.key];
            const pct = (v / aliveTotal) * 100;
            return v > 0 ? (
              <div key={b.key} style={{ width: `${pct}%`, backgroundColor: b.color }} title={`${b.label}: ${v}`} />
            ) : null;
          })}
        </div>

        <ul className="space-y-0.5">{ALIVE_BUCKETS.map((b) => renderRow(b))}</ul>

        {/* Dormant — excluded from the number. Stronger divider so it reads as clearly separate; faded further, still drillable. */}
        <div className="mt-2 border-t-2 border-slate-300 pt-2">
          <ul>{renderRow(DORMANT_BUCKET, true)}</ul>
        </div>
      </div>
    </div>
  );
}

// The drill table: the products behind the selected bucket. Columns differ by channel (Amazon adds the SKU code). Read-only for now —
// the next step is linking each row into the Pricing / Amazon module to price / restock / remove / park.
function BucketList({
  channel, bucket, rows, loading, onClose,
}: {
  channel: 'SHP' | 'AMZ'; bucket: StockBucket; rows: StockListItem[]; loading: boolean; onClose: () => void;
}) {
  const meta = BUCKETS.find((b) => b.key === bucket);
  const channelName = channel === 'SHP' ? 'Shopify' : 'Amazon';
  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);

  return (
    <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: meta?.color }} />
          <span className="font-medium text-slate-800">{channelName} — {meta?.label}</span>
          <span className="text-slate-400">({loading ? '…' : rows.length})</span>
          {meta && <span className="hidden text-xs text-slate-400 md:inline">— {meta.desc}</span>}
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100">
          Close ✕
        </button>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-sm text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">Nothing in this bucket.</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">Product</th>
                {channel === 'AMZ' && <th className="px-3 py-2.5 font-medium">SKU</th>}
                <th className="px-3 py-2.5 text-right font-medium">Price</th>
                <th className="px-3 py-2.5 text-right font-medium">{channel === 'AMZ' ? 'FBA' : 'Stock'}</th>
                <th className="px-3 py-2.5 text-right font-medium">Last sold</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code || r.groupid} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2 text-slate-700">
                    {r.title || <span className="text-slate-400">Untitled</span>}
                    <span className="ml-2 text-xs text-slate-400">{r.groupid}</span>
                  </td>
                  {channel === 'AMZ' && <td className="px-3 py-2 font-mono text-xs text-slate-500">{r.code}</td>}
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.price)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.stock}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.last_sold || <span className="text-slate-300">never</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// In-stock-+-selling over time: two lines (Shopify + Amazon) on a shared count axis. Lightweight inline SVG, no chart lib.
function SellingChart({ shp, amz }: { shp: StockPositionRow[]; amz: StockPositionRow[] }) {
  const W = 720, H = 220, padL = 34, padR = 16, padT = 12, padB = 24;
  // Shared x-axis over the union of dates present (both channels are snapshotted together, so their dates line up).
  const dates = Array.from(new Set([...shp, ...amz].map((r) => r.date))).sort();
  const n = dates.length;
  const idx = (d: string) => dates.indexOf(d);
  const maxY = Math.max(1, ...shp.map((r) => r.in_stock_selling), ...amz.map((r) => r.in_stock_selling));
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (v: number) => padT + (1 - v / maxY) * (H - padT - padB);
  const line = (rows: StockPositionRow[]) => rows.map((r) => `${x(idx(r.date))},${y(r.in_stock_selling)}`).join(' ');

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-brand-600" /> Shopify in stock + selling</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded" style={{ backgroundColor: '#7c3aed' }} /> Amazon in stock + selling</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 460 }} role="img" aria-label="In stock and selling over time by channel">
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
          <circle key={`a${r.date}`} cx={x(idx(r.date))} cy={y(r.in_stock_selling)} r={2} fill="#7c3aed">
            <title>{`${r.date}: ${r.in_stock_selling} in stock + selling / ${r.alive} active (Amazon)`}</title>
          </circle>
        ))}
        <polyline points={line(shp)} fill="none" stroke="#0284c7" strokeWidth={2} />
        {shp.map((r) => (
          <circle key={`s${r.date}`} cx={x(idx(r.date))} cy={y(r.in_stock_selling)} r={2} fill="#0284c7">
            <title>{`${r.date}: ${r.in_stock_selling} in stock + selling / ${r.alive} active (Shopify)`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
