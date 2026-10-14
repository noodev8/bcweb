'use client';
/*
=======================================================================================================================================
Page: /analytics/sell-through  (Reports -> Sell-through, 2026-10-14)
=======================================================================================================================================
Purpose: Units only. Owner, 2026-10-14: "We bought it, we sell it. How many have we got and are we getting through them." and "I want
         to be able to see trend and compare as well to see if my decisions are working." The target: push the excess unit count
         down, then grow profit while total stock grows at a healthy pace.

         Top to bottom:
           1. HELD NOW + three move boxes (today / 7 / 30 days): pairs out, pairs in, and the net — "today we made 7 sales and nothing
              came in, so 7 moves towards selling all our stock; a delivery pushes us back".
           2. THE TREND — pairs held at each month end, stacked by age (light = just arrived, dark = over a year, grey = came in before
              Goods In logging began). The old part of the stack is the excess; it should shrink.
           3. MONTH BY MONTH — in, sold, held, the age bands, profit; sold / held / profit carry the change on the same month a year
              earlier (from Jan 2026), which is the compare.
           4. DELIVERIES — each arrival month: pairs in, and the share gone 3 and 6 month-ends later and now. Did that month's buying
              sell through?
           5. STYLES — every style held now, its pairs by age, oldest-heavy first. Where the over-buying sits.

         HOW A PAIR IS DATED: oldest sells first, per code (server utils/unitAge.js). Nothing per unit is stored — it can't be known
         which of two identical pairs was picked. FBA pairs count the same as shelf pairs; returns go back into the pot (owner).
         Past month ends are rebuilt backwards from today, so the further back, the rougher (see unitAge.js).

         NO "OLD" LINE — the owner chose not to set one yet. The bands are descriptive; don't turn one into a flag or rule.

Guarded by AppShell. Consumes GET /analytics-sell-through.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSellThrough, AgeBands, SellThroughData, SellThroughMonth, SellThroughCohort, SellThroughStyle } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');
const gbp = (v: number) => `£${Math.round(v).toLocaleString('en-GB')}`;

// 'YYYY-MM' / 'YYYY-MM-DD' -> labels without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
const dateLabel = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(2, 4)}`;

// Age bands, young -> old. One blue, light -> dark (an ordinal ramp, validated: dataviz palette steps 250/400/550/700), and a neutral
// grey for pairs that predate the Goods In log — their age is unknown, so they sit outside the ramp. Legend + table carry every value.
const BANDS: { key: keyof AgeBands; label: string; color: string }[] = [
  { key: 'm0_3', label: 'Up to 3 months', color: '#86b6ef' },
  { key: 'm3_6', label: '3–6 months', color: '#3987e5' },
  { key: 'm6_12', label: '6–12 months', color: '#1c5cab' },
  { key: 'm12', label: 'Over a year', color: '#0d366b' },
  { key: 'pre', label: 'Before 2025', color: '#a8a29e' },
];

export default function SellThroughPage() {
  const q = useApiQuery('analytics-sell-through', () => getSellThrough());
  const d = q.data;
  return (
    <AppShell backHref="/dashboard?g=reports" backLabel="Back Office">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {d && (
        <>
          <Moves data={d} />
          <div className="mt-6"><AgeChart months={d.months} /></div>
          <MonthTable months={d.months} />
          <CohortTable cohorts={d.cohorts} />
          {/* useTableSort reads useSearchParams, so the sortable list needs a Suspense boundary for Next's build. */}
          <Suspense fallback={null}><StyleTable styles={d.styles} /></Suspense>
        </>
      )}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// MOVES — held now, then today / 7 / 30 days. The net leads each box: minus = we got through stock, plus = a delivery pushed us back.
// The net is in − out, so it is the pairs-held change bar adjustments (which the owner asked not to see).
// -------------------------------------------------------------------------------------------------------------------------------------
function Moves({ data }: { data: SellThroughData }) {
  const held = data.months[data.months.length - 1]?.held ?? 0;
  const boxes = [
    { label: 'Today', v: data.recent.d1 },
    { label: 'Last 7 days', v: data.recent.d7 },
    { label: 'Last 30 days', v: data.recent.d30 },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <div className="flex flex-col justify-end rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <span className="text-5xl font-semibold leading-none text-slate-900">{n(held)}</span>
        <span className="mt-2 text-sm text-slate-500">pairs held now</span>
      </div>
      {boxes.map(({ label, v }) => {
        const net = v.in - v.sold;
        return (
          <div key={label} className="flex flex-col justify-end rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-3xl font-semibold leading-none text-slate-800">
              {net > 0 ? '+' : net < 0 ? '−' : ''}{n(Math.abs(net))}
            </div>
            <div className="mt-2 text-sm text-slate-500">
              {n(v.sold)} out · {n(v.in)} in
            </div>
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// TREND — pairs held at each month end, stacked by age (oldest at the base, so the excess reads as the floor it is). One units axis.
// Stacked segments get a 2px surface gap; hover a month for its readout. Every number is also in the table below.
// -------------------------------------------------------------------------------------------------------------------------------------
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function AgeChart({ months }: { months: SellThroughMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 280, M = { t: 12, r: 12, b: 34, l: 52 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const max = Math.max(1, ...months.map((p) => p.held));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const base = M.t + ph;
  const y = (v: number) => base - (v / top) * ph;
  const band = pw / months.length;
  const colW = Math.min(26, band * 0.6);
  const cx = (i: number) => M.l + band * i + band / 2;
  // Stack order bottom -> top: oldest first.
  const stack = [...BANDS].reverse();
  const h = hover !== null ? months[hover] : null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-sm font-medium text-slate-700">Pairs held at month end, by how long they&rsquo;ve been here</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
        {BANDS.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: b.color }} />{b.label}
          </span>
        ))}
      </div>

      <div className="relative mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }} role="img"
          aria-label="Pairs held at each month end, stacked by age. The same numbers are in the table below."
          onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#64748b">{n(t)}</text>
            </g>
          ))}
          {hover !== null && <rect x={M.l + band * hover} y={M.t} width={band} height={ph} fill="#f1f5f9" />}

          {months.map((p, i) => {
            let acc = 0;
            const x = cx(i) - colW / 2;
            const segs = stack.filter((b) => p.bands[b.key] > 0);
            return (
              <g key={p.month} opacity={p.partial ? 0.55 : 1}>
                {segs.map((b, si) => {
                  const v = p.bands[b.key];
                  const y0 = y(acc), y1 = y(acc + v);
                  acc += v;
                  const isTop = si === segs.length - 1;
                  // 2px surface gap between stacked segments; the top segment gets the 4px rounded data-end.
                  const hgt = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0));
                  const yTop = y1;
                  if (!isTop) return <rect key={b.key} x={x} y={yTop} width={colW} height={hgt} fill={b.color} />;
                  const r = Math.min(4, colW / 2, hgt);
                  return (
                    <path key={b.key} fill={b.color}
                      d={`M${x},${yTop + hgt} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + colW - r} Q${x + colW},${yTop} ${x + colW},${yTop + r} V${yTop + hgt} Z`} />
                  );
                })}
              </g>
            );
          })}

          {months.map((p, i) => {
            const m = Number(p.month.slice(5, 7));
            return (
              <text key={p.month} x={cx(i)} y={base + 16} textAnchor="middle" fontSize={11} fill="#64748b">
                {MONTHS[m - 1].slice(0, 1)}
                {(i === 0 || m === 1) && <tspan x={cx(i)} dy={13}>{p.month.slice(0, 4)}</tspan>}
              </text>
            );
          })}

          {months.map((p, i) => (
            <rect key={p.month} x={M.l + band * i} y={M.t} width={band} height={ph} fill="transparent" onPointerEnter={() => setHover(i)} />
          ))}
        </svg>

        {h && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(cx(hover!) / W) * 100}%`,
              transform: hover! > months.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}>
            <div className="font-medium text-slate-800">{monthLabel(h.month)}{h.partial ? ' (so far)' : ''}</div>
            <div className="mt-1 text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{n(h.held)}</span> pairs held</div>
            {BANDS.map((b) => (
              <div key={b.key} className="flex items-center gap-2 text-slate-600">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                <span className="w-8 text-right font-semibold tabular-nums text-slate-900">{n(h.bands[b.key])}</span> {b.label.toLowerCase()}
              </div>
            ))}
            <div className="mt-1 text-slate-500">{n(h.sold)} sold · {n(h.in)} in</div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// MONTH BY MONTH — newest first. Sold / held / profit show the change on the same month a year earlier when there is one (the compare);
// the open month has no change (it's part of a month).
// -------------------------------------------------------------------------------------------------------------------------------------
function yoy(cur: number, prev: number | undefined) {
  if (prev === undefined || prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return <div className="text-[11px] text-slate-400">{pct > 0 ? '+' : pct < 0 ? '−' : ''}{Math.abs(pct)}% on last yr</div>;
}

function MonthTable({ months }: { months: SellThroughMonth[] }) {
  const byMonth = new Map(months.map((p) => [p.month, p]));
  const lastYear = (p: SellThroughMonth) => (p.partial ? undefined : byMonth.get(`${Number(p.month.slice(0, 4)) - 1}${p.month.slice(4)}`));
  const th = 'px-3 py-2.5 text-right font-semibold';
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left font-semibold">Month</th>
            <th className={th}>In</th>
            <th className={th}>Sold</th>
            <th className={th}>Held</th>
            {BANDS.map((b) => (
              <th key={b.key} className={`${th} whitespace-nowrap normal-case`}>
                <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ backgroundColor: b.color }} />{b.label}
              </th>
            ))}
            <th className={`${th} pr-4`}>Profit</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((p) => {
            const ly = lastYear(p);
            return (
              <tr key={p.month} className={`border-b border-slate-100 align-top last:border-0 ${p.partial ? 'text-slate-400' : 'text-slate-700'}`}>
                <td className="whitespace-nowrap px-4 py-2">{monthLabel(p.month)}{p.partial && <span className="ml-2 text-xs">so far</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n(p.in)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{n(p.sold)}{yoy(p.sold, ly?.sold)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">{n(p.held)}{yoy(p.held, ly?.held)}</td>
                {BANDS.map((b) => (
                  <td key={b.key} className="px-3 py-2 text-right tabular-nums">{p.bands[b.key] ? n(p.bands[b.key]) : '—'}</td>
                ))}
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{gbp(p.profit)}{yoy(p.profit, ly?.profit)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// DELIVERIES — per arrival month, the share of its pairs gone 3 and 6 month-ends later, and now. Comparing the same column down the list
// is the fair compare (each month has had the same time to sell); "now" favours the older months.
// -------------------------------------------------------------------------------------------------------------------------------------
function gone(c: SellThroughCohort, left: number | null) {
  if (left === null) return <span className="text-slate-300">—</span>;
  const pct = c.in ? Math.round(((c.in - left) / c.in) * 100) : 0;
  return (
    <>
      <span className="font-semibold text-slate-900">{pct}%</span>
      <span className="ml-1.5 text-xs text-slate-400">{n(left)} left</span>
    </>
  );
}

function CohortTable({ cohorts }: { cohorts: SellThroughCohort[] }) {
  const th = 'px-4 py-2.5 text-right font-semibold';
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">Deliveries — how much of each month&rsquo;s arrivals has sold</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-2.5 text-left font-semibold">Arrived</th>
            <th className={th}>Pairs in</th>
            <th className={th}>Sold after 3 months</th>
            <th className={th}>After 6 months</th>
            <th className={th}>Sold now</th>
          </tr>
        </thead>
        <tbody>
          {[...cohorts].reverse().map((c) => (
            <tr key={c.month} className="border-b border-slate-100 text-slate-700 last:border-0">
              <td className="whitespace-nowrap px-4 py-2">{monthLabel(c.month)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{n(c.in)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{gone(c, c.left_3m)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{gone(c, c.left_6m)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{gone(c, c.left_now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// STYLES — every style held now, pairs by age. Opens oldest-heavy (the server's order: over a year incl. before 2025, then 6–12 months,
// then most pairs); headers sort. GROUPID opens the Shopify price drill, ← Back returns here.
// -------------------------------------------------------------------------------------------------------------------------------------
function StyleTable({ styles }: { styles: SellThroughStyle[] }) {
  const { sorted, sort, onSort } = useTableSort(styles, {
    groupid: (s) => s.groupid,
    brand: (s) => s.brand,
    units: (s) => s.units,
    m0_3: (s) => s.bands.m0_3,
    m3_6: (s) => s.bands.m3_6,
    m6_12: (s) => s.bands.m6_12,
    m12: (s) => s.bands.m12 + s.bands.pre,
    oldest: (s) => s.oldest ?? '0000',
    sold_90: (s) => s.sold_90,
  });
  const th = { sort, onSort };
  const self = encodeURIComponent(`/analytics/sell-through${sort ? `?sort=${sort.key}.${sort.dir}` : ''}`);
  const cell = (v: number) => (v ? n(v) : <span className="text-slate-300">—</span>);

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
        Styles held now, by age of their pairs <span className="font-normal text-slate-400">· {styles.length} styles</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <SortableTh {...th} sortKey="groupid" label="Style" firstDir="asc" />
              <SortableTh {...th} sortKey="brand" label="Brand" firstDir="asc" />
              <SortableTh {...th} sortKey="units" label="Pairs" align="right" />
              <SortableTh {...th} sortKey="m0_3" label="Up to 3m" align="right" />
              <SortableTh {...th} sortKey="m3_6" label="3–6m" align="right" />
              <SortableTh {...th} sortKey="m6_12" label="6–12m" align="right" />
              <SortableTh {...th} sortKey="m12" label="Over a year" align="right" title="Includes pairs that came in before 2025" />
              <SortableTh {...th} sortKey="oldest" label="Oldest" align="right" firstDir="asc" />
              <SortableTh {...th} sortKey="sold_90" label="Sold 90d" align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.groupid} className="border-b border-slate-100 text-slate-700 last:border-0">
                <td className="whitespace-nowrap px-4 py-2">
                  <Link href={`/pricing/style/${encodeURIComponent(s.groupid)}?from=${self}`} title={s.title ?? undefined}
                    className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {s.groupid}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-500">{s.brand || '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{n(s.units)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{cell(s.bands.m0_3)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{cell(s.bands.m3_6)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{cell(s.bands.m6_12)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{cell(s.bands.m12 + s.bands.pre)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{s.oldest ? dateLabel(s.oldest) : 'before 2025'}</td>
                <td className="px-4 py-2 text-right tabular-nums">{n(s.sold_90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
