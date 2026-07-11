'use client';
/*
=======================================================================================================================================
Page: /analytics/birk-tracker  (Analytics module — Birk Tracker)
=======================================================================================================================================
Purpose: A snapshot gauge of Birkenstock core-size availability — the Google-Ads push/scale-back signal (ported from the reference
         tool C:\scripts\birk-stock, but self-contained here with history in Postgres).

           - Full   = Birk styles holding all 3 women's core sizes (38/39/40) in FREE stock right now. The decision number: the
                      breadth of core-complete product ad spend can confidently ride. Read as a level AND a direction.
           - Styles = every in-range Birk style (grid offers 38/39/40). The ceiling.
           - Full % = Full / Styles. The trend gauge (progress toward a fully stocked range), not the decision driver.

         The headline shows the latest stored snapshot. "Update now" recomputes today's reading (POST /birk-tracker-update, which
         upserts one row per day and prunes anything older than 2 years — so the store can never grow unbounded). Below: a simple
         line chart of Full over the window, and the raw daily table (newest first).

Guarded by AppShell. Consumes GET /birk-tracker + POST /birk-tracker-update.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { getBirkTracker, updateBirkTracker, BirkSnapshot } from '@/lib/api';

export default function BirkTrackerPage() {
  const { logout } = useAuth();
  const [rows, setRows] = useState<BirkSnapshot[]>([]);
  const [latest, setLatest] = useState<BirkSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getBirkTracker(90);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setLatest(res.data.latest);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Birk Tracker');
    }
    setLoading(false);
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  async function onUpdate() {
    setUpdating(true);
    setNotice(null);
    setError(null);
    const res = await updateBirkTracker();
    if (res.success && res.data) {
      const l = res.data.latest;
      const stock = l.total_free != null ? `, ${l.total_free} units in stock` : '';
      setNotice(`Snapshot updated — ${l.full} Full of ${l.styles} styles (${l.full_pct}%)${stock}.`);
      await load();
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to update snapshot');
    }
    setUpdating(false);
  }

  // Newest-first for the table; the chart wants oldest->newest (as returned).
  const tableRows = useMemo(() => [...rows].reverse(), [rows]);

  return (
    <AppShell title="Birk Tracker" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        How much of the Birkenstock core-size range is buyable right now. <strong>Full</strong> — styles holding all three women&apos;s
        core sizes (38 / 39 / 40) in free stock — is the number to push ad spend against; <strong>Styles</strong> is the in-range
        ceiling. Read Full as a level and a direction. The amber line overlays <strong>trailing 7-day Birk units sold</strong>
        (all-channel) so you can eyeball whether availability tracks demand — though both tend to rise together in season, so
        co-movement isn&apos;t proof one drives the other. <strong>Stock</strong> is total Birk free units on hand (the whole tank) and
        <strong> Cover</strong> is weeks of that stock at the current sales burn — the forward &ldquo;are we draining?&rdquo; gauge for
        pushing or easing ad spend. Hit <em>Update now</em> to take a fresh reading (one snapshot per day).
      </p>

      {/* Headline + Update */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {latest ? (
          <div className="flex flex-wrap items-end gap-6 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
            <Stat label="Full" value={String(latest.full)} accent />
            <Stat label="Styles" value={String(latest.styles)} />
            <Stat label="Full %" value={`${latest.full_pct}%`} />
            <Stat label="Sales 7d" value={String(latest.units7)} tone="text-amber-600" />
            <Stat label="Stock" value={latest.total_free != null ? String(latest.total_free) : '—'} tone="text-emerald-600" />
            <Stat label="Cover" value={latest.cover_weeks != null ? `${latest.cover_weeks}w` : '—'} tone="text-emerald-600" />
            <div className="text-xs text-slate-400">as of {latest.date}</div>
          </div>
        ) : (
          !loading && <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-4 text-sm text-slate-500">
            No snapshots yet — hit <strong>Update now</strong> to take the first reading.
          </div>
        )}

        <button
          onClick={onUpdate}
          disabled={updating}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {updating ? 'Updating…' : 'Update now'}
        </button>
      </div>

      {notice && <div className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && rows.length > 0 && (
        <>
          <FullChart rows={rows} />

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 text-right font-medium">Full</th>
                  <th className="px-3 py-2.5 text-right font-medium">Styles</th>
                  <th className="px-3 py-2.5 text-right font-medium">Full %</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sales 7d</th>
                  <th className="px-3 py-2.5 text-right font-medium">Stock</th>
                  <th className="px-3 py-2.5 text-right font-medium">Core</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cover</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.date} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2 tabular-nums text-slate-700">{r.date}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">{r.full}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.styles}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.full_pct}%</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-600">{r.units7}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.total_free != null ? r.total_free : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.core_free != null ? r.core_free : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-600">{r.cover_weeks != null ? `${r.cover_weeks}w` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!loading && rows.length === 0 && !error && (
        <p className="text-sm text-slate-400">No history yet. Take a snapshot to start the trend.</p>
      )}
    </AppShell>
  );
}

function Stat({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: string }) {
  const color = tone || (accent ? 'text-brand-600' : 'text-slate-800');
  return (
    <div>
      <div className={'text-3xl font-semibold tabular-nums ' + color}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}

// A lightweight inline SVG chart. No chart lib. Two axes:
//   LEFT  (styles scale) — Full (brand line) below its Styles ceiling (dashed grey).
//   RIGHT (units scale)  — Sales 7d (amber line), a live trailing-7-day Birk units read, so you can eyeball whether availability
//                          and demand move together. Separate axis because units (100s) and style counts (10s) don't share a scale.
function FullChart({ rows }: { rows: BirkSnapshot[] }) {
  const W = 720, H = 210, padL = 34, padR = 40, padT = 12, padB = 24;
  const maxL = Math.max(1, ...rows.map((r) => r.styles));  // left axis: the styles ceiling
  const maxR = Math.max(1, ...rows.map((r) => r.units7));  // right axis: peak trailing-7d units
  const n = rows.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const yL = (v: number) => padT + (1 - v / maxL) * (H - padT - padB);
  const yR = (v: number) => padT + (1 - v / maxR) * (H - padT - padB);

  const lineL = (key: 'full' | 'styles') => rows.map((r, i) => `${x(i)},${yL(r[key])}`).join(' ');
  const lineUnits = rows.map((r, i) => `${x(i)},${yR(r.units7)}`).join(' ');

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-brand-600" /> Full</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-slate-300" /> Styles (ceiling)</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-amber-500" /> Sales 7d (units, right axis)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 460 }} role="img" aria-label="Full styles vs trailing 7-day Birk sales">
        {/* left-axis gridlines + labels (styles scale) at 0, mid, max */}
        {[0, Math.round(maxL / 2), maxL].map((v) => (
          <g key={`l${v}`}>
            <line x1={padL} y1={yL(v)} x2={W - padR} y2={yL(v)} stroke="#f1f5f9" />
            <text x={padL - 6} y={yL(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{v}</text>
          </g>
        ))}
        {/* right-axis labels (units scale) at 0, mid, max, in amber */}
        {[0, Math.round(maxR / 2), maxR].map((v) => (
          <text key={`r${v}`} x={W - padR + 6} y={yR(v) + 3} textAnchor="start" fontSize="10" fill="#d97706">{v}</text>
        ))}
        {/* Sales (right axis) drawn first so the Full line sits on top */}
        <polyline points={lineUnits} fill="none" stroke="#f59e0b" strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={`u${r.date}`} cx={x(i)} cy={yR(r.units7)} r={2} fill="#f59e0b">
            <title>{`${r.date}: ${r.units7} units (7d)`}</title>
          </circle>
        ))}
        {/* x-axis date labels — show ~6 evenly spaced so they don't crowd (e.g. "2 Jun") */}
        {rows.map((r, i) => {
          const step = Math.max(1, Math.ceil(n / 6));
          if (i % step !== 0 && i !== n - 1) return null;
          const d = new Date(r.date);
          const lbl = `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}`;
          return <text key={`x${r.date}`} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{lbl}</text>;
        })}
        {/* Availability (left axis) */}
        <polyline points={lineL('styles')} fill="none" stroke="#cbd5e1" strokeWidth={1.5} strokeDasharray="4 3" />
        <polyline points={lineL('full')} fill="none" stroke="#0284c7" strokeWidth={2} />
        {rows.map((r, i) => (
          <circle key={r.date} cx={x(i)} cy={yL(r.full)} r={2} fill="#0284c7">
            <title>{`${r.date}: ${r.full} / ${r.styles} Full (${r.full_pct}%) · ${r.units7} units 7d`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
