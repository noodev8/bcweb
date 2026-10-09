'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-sales  (Reports — Stock vs Sales)
=======================================================================================================================================
Purpose: Is the stock we buy shifting? Units owned at the end of each week (or month) against units sold in it — the owner's read on
         whether to slow ordering down or speed it up (2026-10-09: "Just sales against stock position").

         Replaced the Stock Position gauge (a count of "alive" products, recorded by an Update button) on 2026-10-09. Nothing on this
         page writes: the stock line is the nightly stock_daily reading (bcweb-server/scripts/stock-daily.js), and sales are read live.

THE DATA, PLAINLY — NO VERDICT YET
         Owner's order of work: clean the data and see it here first; the analysis (a months-of-stock headline against the same time
         last year) comes once the line is trusted. So this page states readings and draws them. It does not judge them.

TWO CHARTS, ONE TIME AXIS — NEVER ONE CHART WITH TWO SCALES
         Stock runs ~2,000–3,800 units; a week sells ~20–400. On one axis the bars would be a flat line; on two axes the reader compares
         heights that mean nothing against each other. So stock and sold are stacked panels sharing the x-axis, hovered together.

WHOLE BOOK, ALL CHANNELS
         Stock includes Amazon-held units, so sold includes Amazon too (and the shop) — otherwise the two halves describe different stock.
         Sold is NET of returns, as everywhere else on Reports.

THE STEP AT `basis_from`
         Readings before it were backfilled from the retired google_stock_track, which counted Amazon SELLABLE units only. From it on,
         the reading is the Month End figure, which also counts Amazon in-transit/reserved units — so the line steps up ~3% there with no
         real stock movement. Marked on the chart so it is never read as a delivery.

Guarded by AppShell. Consumes GET /analytics-stock-sales.
=======================================================================================================================================
*/

import { useState } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStockSales, StockSalesPeriod } from '@/lib/api';

type Grain = 'week' | 'month';

// Channel identity — the first three slots of the validated categorical order (blue / orange / aqua: all-pairs CVD ΔE ≥ 9.2 on white).
// Aqua sits under 3:1 contrast on white, which the table below the chart relieves. Fixed per channel, never per rank.
const CHANNELS = [
  { key: 'sold_shp', label: 'Shopify', color: '#2a78d6' },
  { key: 'sold_amz', label: 'Amazon', color: '#eb6834' },
  { key: 'sold_shop', label: 'Shop', color: '#1baf7a' },
] as const;
const STOCK_COLOR = '#334155'; // slate-700 — a single series needs no hue

const n = (v: number) => v.toLocaleString('en-GB');
const money = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;

// 'YYYY-MM-DD' -> parts without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
function dayLabel(s: string) {
  const { m, d } = ymd(s);
  return `${d} ${MONTHS[m - 1]}`;
}
function periodLabel(p: StockSalesPeriod, grain: Grain) {
  const { y, m } = ymd(p.start);
  return grain === 'month' ? `${MONTHS[m - 1]} ${y}` : `w/c ${dayLabel(p.start)} ${String(y).slice(2)}`;
}

// A round axis top: the next 1 / 2 / 2.5 / 5 x 10^k at or above v.
function niceMax(v: number) {
  if (v <= 0) return 1;
  const k = Math.pow(10, Math.floor(Math.log10(v)));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * k >= v) return f * k;
  return 10 * k;
}

export default function StockSalesPage() {
  const [grain, setGrain] = useState<Grain>('week');
  const q = useApiQuery(['analytics-stock-sales', grain], () => getStockSales(grain));
  const d = q.data;
  const stale = d?.latest && d.latest.date < d.expected_date;

  return (
    <AppShell backHref="/analytics" backLabel="Reports">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Units we own at the end of each {grain}, against units sold in it — all channels, net of returns.
        </p>
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {(['week', 'month'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrain(g)}
              aria-pressed={grain === g}
              className={
                'rounded-md px-3.5 py-1.5 text-sm font-medium capitalize transition ' +
                (grain === g ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}

      {stale && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The latest stock reading is {dayLabel(d!.latest!.date)} — the nightly job hasn&rsquo;t recorded {dayLabel(d!.expected_date)}.
          Check Bclog for a &ldquo;Stock Daily&rdquo; entry.
        </div>
      )}

      {d && d.latest && (
        <div className="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div>
            <span className="text-2xl font-semibold tabular-nums text-slate-900">{n(d.latest.units)}</span>
            <span className="ml-1.5 text-sm text-slate-500">units in stock</span>
          </div>
          <span className="text-sm tabular-nums text-slate-600">{money(d.latest.value)} at cost</span>
          {d.latest.local_units !== null && d.latest.amz_units !== null && (
            <span className="text-sm tabular-nums text-slate-500">
              {n(d.latest.local_units)} here · {n(d.latest.amz_units)} at Amazon
            </span>
          )}
          <span className="text-xs text-slate-400">end of {dayLabel(d.latest.date)}</span>
        </div>
      )}

      {d && d.periods.length > 0 && (
        <>
          <Chart periods={d.periods} grain={grain} basisFrom={d.basis_from} />
          <PeriodTable periods={d.periods} grain={grain} basisFrom={d.basis_from} />
        </>
      )}
      {d && d.periods.length === 0 && <p className="text-sm text-slate-400">No stock readings yet.</p>}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// CHART — stock line over stacked sold bars, one shared x-axis, one shared hover. The readout line above the plot shows the hovered
// period (the newest one when nothing is hovered), so the exact numbers are always one glance away without a floating tooltip.
// -------------------------------------------------------------------------------------------------------------------------------------
function Chart({ periods, grain, basisFrom }: { periods: StockSalesPeriod[]; grain: Grain; basisFrom: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, padL = 44, padR = 12;
  const topH = 190, gap = 26, botH = 130, axisH = 20;
  const H = topH + gap + botH + axisH;
  const count = periods.length;
  const band = (W - padL - padR) / count;
  const cx = (i: number) => padL + band * (i + 0.5);

  const stockMax = niceMax(Math.max(...periods.map((p) => p.stock ?? 0)));
  const soldMax = niceMax(Math.max(...periods.map((p) => CHANNELS.reduce((s, c) => s + Math.max(0, p[c.key]), 0))));
  const yStock = (v: number) => topH - (v / stockMax) * (topH - 8);
  const botTop = topH + gap;
  const ySold = (v: number) => botTop + botH - (v / soldMax) * botH;

  // Line through the periods that have a reading; a period with none breaks the line rather than inventing a value.
  const segments: string[] = [];
  let cur: string[] = [];
  periods.forEach((p, i) => {
    if (p.stock === null) { if (cur.length) segments.push(cur.join(' ')); cur = []; return; }
    cur.push(`${cx(i)},${yStock(p.stock)}`);
  });
  if (cur.length) segments.push(cur.join(' '));

  // The first period on the Month End basis (the backfill ends just before it).
  const basisIdx = basisFrom ? periods.findIndex((p) => p.stock_date !== null && p.stock_date >= basisFrom) : -1;
  const barW = Math.max(2, Math.min(28, band - 2)); // 2px surface gap between neighbouring bars

  const shown = periods[hover ?? count - 1];

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4 text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ backgroundColor: STOCK_COLOR }} /> In stock</span>
          {CHANNELS.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: c.color }} /> {c.label}
            </span>
          ))}
        </div>
        <div className="tabular-nums text-slate-600">
          <span className="font-medium text-slate-800">{periodLabel(shown, grain)}{shown.partial ? ' (so far)' : ''}</span>
          {' · '}stock {shown.stock === null ? '—' : n(shown.stock)}
          {' · '}sold {n(shown.sold)}
          <span className="text-slate-400"> ({CHANNELS.map((c) => `${c.label} ${n(shown[c.key])}`).join(', ')})</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }} role="img"
             aria-label="Units in stock at the end of each period, and units sold in it by channel"
             onMouseLeave={() => setHover(null)}>
          {/* Panel captions */}
          <text x={padL} y={10} fontSize="10" fill="#64748b">In stock</text>
          <text x={padL} y={botTop - 6} fontSize="10" fill="#64748b">Sold</text>

          {/* Recessive gridlines + y labels, both panels */}
          {[0, 0.5, 1].map((f) => {
            const v = stockMax * f;
            return (
              <g key={`gs${f}`}>
                <line x1={padL} y1={yStock(v)} x2={W - padR} y2={yStock(v)} stroke="#f1f5f9" />
                <text x={padL - 6} y={yStock(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{n(v)}</text>
              </g>
            );
          })}
          {[0, 0.5, 1].map((f) => {
            const v = soldMax * f;
            return (
              <g key={`gb${f}`}>
                <line x1={padL} y1={ySold(v)} x2={W - padR} y2={ySold(v)} stroke="#f1f5f9" />
                <text x={padL - 6} y={ySold(v) + 3} textAnchor="end" fontSize="10" fill="#94a3b8">{n(v)}</text>
              </g>
            );
          })}

          {/* Basis change marker */}
          {basisIdx > 0 && (
            <g>
              <line x1={cx(basisIdx) - band / 2} y1={4} x2={cx(basisIdx) - band / 2} y2={topH} stroke="#94a3b8" strokeDasharray="3 3" />
              <text x={cx(basisIdx) - band / 2 - 4} y={topH - 4} textAnchor="end" fontSize="9" fill="#64748b">
                Amazon in transit counted from here
              </text>
            </g>
          )}

          {/* Crosshair */}
          {hover !== null && (
            <line x1={cx(hover)} y1={4} x2={cx(hover)} y2={botTop + botH} stroke="#cbd5e1" />
          )}

          {/* Sold: stacked bars, Shopify at the base. A segment sitting on another gives up 2px at its foot — the surface gap that
              keeps neighbours distinct. A channel's net-negative period (more returned than sold) draws nothing; the table has it.
              The open period is drawn faint — it is still filling. */}
          {periods.map((p, i) => {
            let base = 0;
            return (
              <g key={`b${p.start}`} opacity={p.partial ? 0.45 : 1}>
                {CHANNELS.map((c) => {
                  const v = Math.max(0, p[c.key]);
                  if (v === 0) return null;
                  const foot = base > 0 ? 2 : 0;
                  const y0 = ySold(base), y1 = ySold(base + v);
                  base += v;
                  return (
                    <rect key={c.key} x={cx(i) - barW / 2} y={y1} width={barW} height={Math.max(0.5, y0 - y1 - foot)} fill={c.color} />
                  );
                })}
              </g>
            );
          })}

          {/* Stock line */}
          {segments.map((pts, k) => (
            <polyline key={`l${k}`} points={pts} fill="none" stroke={STOCK_COLOR} strokeWidth={2} strokeLinejoin="round" />
          ))}
          {hover !== null && periods[hover].stock !== null && (
            <circle cx={cx(hover)} cy={yStock(periods[hover].stock!)} r={4} fill={STOCK_COLOR} stroke="#fff" strokeWidth={2} />
          )}

          {/* X labels */}
          {periods.map((p, i) => {
            const { y, m, d } = ymd(p.start);
            if (grain === 'week' && d > 7) return null; // weekly: label only the first week of each month
            const lbl = m === 1 || i === 0 ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : MONTHS[m - 1];
            return <text key={`x${p.start}`} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">{lbl}</text>;
          })}

          {/* Hit targets — a full-height column per period, wider than any mark */}
          {periods.map((p, i) => (
            <rect key={`h${p.start}`} x={padL + band * i} y={0} width={band} height={botTop + botH}
                  fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// TABLE — the same numbers, newest first. The chart's exact-value view, and the relief for the low-contrast aqua.
// -------------------------------------------------------------------------------------------------------------------------------------
function PeriodTable({ periods, grain, basisFrom }: { periods: StockSalesPeriod[]; grain: Grain; basisFrom: string | null }) {
  const rows = periods.slice().reverse();
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2 text-left font-semibold">{grain === 'month' ? 'Month' : 'Week'}</th>
              <th className="px-3 py-2 text-right font-semibold">In stock (end)</th>
              <th className="px-3 py-2 text-right font-semibold">Sold</th>
              {CHANNELS.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right font-semibold">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.start} className={`border-b border-slate-100 last:border-0 ${p.partial ? 'text-slate-400' : 'hover:bg-slate-50'}`}>
                <td className="whitespace-nowrap px-4 py-2 font-medium">
                  {periodLabel(p, grain)}
                  {p.partial && <span className="ml-2 text-xs font-normal text-slate-400">so far</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{p.stock === null ? '—' : n(p.stock)}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{n(p.sold)}</td>
                {CHANNELS.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right tabular-nums text-slate-600">{n(p[c.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <p>
          In stock = units we own at the end of the {grain}: our sellable stock plus everything Amazon holds — the Month End figure.
          Sold = all channels, net of returns.
        </p>
        <p>
          {basisFrom
            ? <>Before {dayLabel(basisFrom)} {ymd(basisFrom).y}, readings counted only Amazon&rsquo;s sellable units, so the line steps up slightly there.</>
            : <>Readings so far count only Amazon&rsquo;s sellable units; from the first nightly reading on, Amazon in-transit and reserved units count too, so the line will step up slightly.</>}
        </p>
      </div>
    </div>
  );
}
