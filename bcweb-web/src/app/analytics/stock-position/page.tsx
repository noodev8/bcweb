'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-position  (Back Office -> Stock Position, 2026-10-15)
=======================================================================================================================================
Purpose: The at-a-glance summary of Sell-through. Owner, 2026-10-15: "I wanted to know if we are selling what we are buying ... As a
         summary I need report for current position, progress and something to act on ... cards and numbers at a glance."
         Sell-through (/analytics/sell-through) is now only its data tables (see ONE SCREEN below).

         LAYOUT (owner, 2026-10-15, second pass: "still struggling to understand it. Try a different way"): FOUR QUESTIONS, each
         answered Yes / No / Nearly first, the number under it, the year before under that:
           1. Is 90-day stock building up?   pairs here over 90 days vs the same day a year ago, plus two bars (now / a year ago)
              showing that share of all stock — a picture instead of "66%", which didn't read. Leads: the owner's own words, "I am
              growing the 90 day stock and shouldn't be."
           2. Are we selling more?            pairs sold, 12 months vs the 12 before
           3. Are we selling what we buy?     sold per 100 bought, 12 months (Nearly = 90-99)
           4. Is stock moving faster?         months to sell what we hold, vs a year ago; 3.0 = the 90-day rule
         Then THE SNAKE — pairs held against pairs sold in the 90 days before, every month end (see Snake) — and TO ACT ON: Slow, and
         the styles with more pairs over 90 days than they sold in 90.

         ONE SCREEN (owner, 2026-10-15: "I only use the top stats of the sell through ... Can we combine the screens"): Sell-through's
         moves row (held + today / 7 / 30 / 90) sits at the top. "In stock now" (was "pairs held now") opens /analytics/sell-through, now just the data
         tables, which links back on screen. The Back Office tile opens this screen; Sell-through has no tile of its own.

         90 DAYS is the house rule ("we generally say sell the item inside 90 days", owner). Seasonal stock bought months ahead is over
         90 days by design in autumn — which is why each figure sits beside the same day last year, not a target.

         COLOUR: the answer word — green good, red bad, slate neither; the snake's body — blue fat, amber thin.

Guarded by AppShell. Consumes GET /analytics-stock-position.
=======================================================================================================================================
*/

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getStockPosition, StockPositionData } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

// Change on the year before as "+42%" / "−8%".
function change(cur: number, prev: number) {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return { p, text: `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%` };
}

export default function StockPositionPage() {
  const q = useApiQuery('analytics-stock-position', () => getStockPosition());
  const d = q.data;
  return (
    <AppShell backHref="/dashboard?g=products" backLabel="Products & stock">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {d && <Position data={d} />}
    </AppShell>
  );
}

type Verdict = { word: string; good: boolean | null };

function Position({ data }: { data: StockPositionData }) {
  const { position: p, progress: g, act } = data;
  const more90 = p.past90 - p.past90_ya;
  const soldCh = change(g.sold, g.sold_prev);
  const per100 = pct(g.sold, g.bought);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-900">Stock position</h1>

      <Moves data={data} />

      {/* FOUR QUESTIONS, each answered Yes / No first (owner, 2026-10-15: "still struggling to understand it. Try a different way"). The
          90-day one leads — it is the one the owner named: "I am growing the 90 day stock and shouldn't be." */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Question q="Is 90-day stock building up?" v={more90 > 0 ? { word: 'Yes', good: false } : { word: 'No', good: true }}
          value={n(p.past90)} unit="in stock over 90 days">
          <div>{more90 > 0 ? `${n(more90)} more` : `${n(-more90)} fewer`} than a year ago ({n(p.past90_ya)})</div>
          <Split label="Now" over={p.past90} total={p.held} />
          <Split label="A year ago" over={p.past90_ya} total={p.held_ya} />
        </Question>

        <Question q="Are we selling more?" v={soldCh && soldCh.p > 0 ? { word: 'Yes', good: true } : { word: 'No', good: false }}
          value={n(g.sold)} unit="sold in 12 months">
          {soldCh && <div>{soldCh.text} on the year before ({n(g.sold_prev)})</div>}
        </Question>

        <Question q="Are we selling what we buy?"
          v={per100 >= 100 ? { word: 'Yes', good: true } : per100 >= 90 ? { word: 'Nearly', good: null } : { word: 'No', good: false }}
          value={String(per100)} unit="sold for every 100 bought">
          <div>{n(g.sold)} sold, {n(g.bought)} bought in 12 months</div>
        </Question>

        <Question q="Is stock moving faster?"
          v={p.cover !== null && p.cover_ya !== null && p.cover < p.cover_ya ? { word: 'Yes', good: true } : { word: 'No', good: false }}
          value={p.cover === null ? '–' : p.cover.toFixed(1)} unit="months to sell what we hold">
          {p.cover_ya !== null && <div>{p.cover_ya.toFixed(1)} a year ago · selling inside 90 days = 3.0</div>}
        </Question>
      </section>

      <Snake trend={data.trend} />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">To act on</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link href="/analytics/stock-sales"
            className="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slow</div>
            <div className="mt-2 text-4xl font-bold leading-none tabular-nums text-slate-900 sm:text-5xl">{n(act.slow_styles)}</div>
            <div className="mt-3 text-xs text-slate-500">styles · {n(act.slow_units)} in stock · no sale in 90 days</div>
            <div className="mt-3 text-sm font-medium text-slate-700">Open Slow →</div>
          </Link>
          <BehindList top={act.top} />
        </div>
      </section>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// MOVES — held now, then today / 7 / 30 / 90 days (Sell-through's top stats, moved here 2026-10-15). The net leads each box, out − in:
// positive = we got through stock (owner: "-43 to be 43"), minus = a delivery pushed us back. "In stock now" (was "pairs held now") opens the data page
// (owner: "the navigate should be to the data, not the summary").
// -------------------------------------------------------------------------------------------------------------------------------------
function Moves({ data }: { data: StockPositionData }) {
  const boxes = [
    { label: 'Today', v: data.recent.d1 },
    { label: 'Last 7 days', v: data.recent.d7 },
    { label: 'Last 30 days', v: data.recent.d30 },
    { label: 'Last 90 days', v: data.recent.d90 },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Link href="/analytics/sell-through"
        className="flex flex-col justify-end rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:shadow">
        <span className="text-5xl font-semibold leading-none text-slate-900">{n(data.position.held)}</span>
        <span className="mt-2 text-sm text-slate-500">in stock now</span>
        <span className="mt-2 text-sm font-medium text-slate-700">Data →</span>
      </Link>
      {boxes.map(({ label, v }) => {
        const net = v.sold - v.in;
        return (
          <div key={label} className="flex flex-col justify-end rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-3xl font-semibold leading-none text-slate-800">{net < 0 ? '−' : ''}{n(Math.abs(net))}</div>
            <div className="mt-2 text-sm text-slate-500">{n(v.sold)} out · {n(v.in)} in</div>
          </div>
        );
      })}
    </section>
  );
}

// A question card: the question, the answer word (green = good, red = bad, slate = neither), then the number it rests on.
// With `href` the whole card is a link, its `linkText` at the foot (as the Slow card's "Open Slow →").
function Question({ q, v, value, unit, href, linkText, children }: {
  q: string; v: Verdict; value: string; unit: string; href?: string; linkText?: string; children?: ReactNode;
}) {
  const col = v.good === null ? 'text-slate-700' : v.good ? 'text-emerald-700' : 'text-red-700';
  const body = (
    <>
      <div className="text-sm text-slate-600">{q}</div>
      <div className={`mt-1 text-2xl font-bold ${col}`}>{v.word}</div>
      <div className="mt-3 text-4xl font-bold leading-none tabular-nums text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{unit}</div>
      {children && <div className="mt-3 space-y-1.5 text-xs text-slate-500">{children}</div>}
      {linkText && <div className="mt-3 text-sm font-medium text-slate-700">{linkText}</div>}
    </>
  );
  const box = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
  return href
    ? <Link href={href} className={`block ${box} transition hover:border-slate-300 hover:shadow`}>{body}</Link>
    : <div className={box}>{body}</div>;
}

// One bar of the stock: dark = pairs here over 90 days, light = the rest. Shows the share without asking anyone to read a percentage.
function Split({ label, over, total }: { label: string; over: number; total: number }) {
  const w = total > 0 ? (over / total) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span className="tabular-nums">{n(over)} of {n(total)}</span></div>
      <div className="mt-0.5 flex h-2.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full bg-slate-700" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// THE SNAKE — pairs held at each month end against pairs sold in the 90 days to it (owner, 2026-10-15: "a line fat or thin like a snake
// but hopefully moving upwards. If too fat, I am not selling enough, if too thin, close to running out of stock but quite efficient").
// The shaded gap is the snake's body: blue where we hold more than 90 days of sales (fat), amber where we sold more in 90 days than we
// hold (thin — running close). Where the lines touch, stock = 90 days of sales, the house rule. Every ledger month, so last year's
// snake sits left of this year's. Hover a month for its readout, incl. months of stock (held / sold in 90 days x 3).
// -------------------------------------------------------------------------------------------------------------------------------------
function Snake({ trend }: { trend: StockPositionData['trend'] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!trend.length) return null;
  const W = 760, H = 260, M = { t: 14, r: 120, b: 40, l: 48 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const top = Math.ceil(Math.max(1, ...trend.flatMap((p) => [p.held, p.sold90])) / 1000) * 1000;
  const ticks = Array.from({ length: top / 1000 + 1 }, (_, i) => i * 1000);
  const step = trend.length > 1 ? pw / (trend.length - 1) : 0;
  const x = (i: number) => M.l + (trend.length === 1 ? pw / 2 : step * i);
  const y = (v: number) => M.t + ph - (v / top) * ph;
  const path = (k: 'held' | 'sold90') => trend.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[k])}`).join(' ');
  const BLUE = '#1c5cab', SOLD = '#57534e', FAT = '#dbeafe', THIN = '#fde68a';

  // The body, one piece per month-to-month step, split where the lines cross so each piece is one colour.
  const body: { d: string; fat: boolean }[] = [];
  for (let i = 0; i < trend.length - 1; i++) {
    const a = trend[i], b = trend[i + 1];
    const da = a.held - a.sold90, db = b.held - b.sold90;
    const pt = (t: number, k: 'held' | 'sold90') => [x(i) + step * t, y(a[k] + (b[k] - a[k]) * t)] as const;
    const piece = (t0: number, t1: number) => {
      const [x0, h0] = pt(t0, 'held'), [x1, h1] = pt(t1, 'held'), [, s1] = pt(t1, 'sold90'), [, s0] = pt(t0, 'sold90');
      return `M${x0},${h0} L${x1},${h1} L${x1},${s1} L${x0},${s0} Z`;
    };
    if ((da >= 0) === (db >= 0)) body.push({ d: piece(0, 1), fat: da + db >= 0 });
    else {
      const t = da / (da - db);
      body.push({ d: piece(0, t), fat: da >= 0 }, { d: piece(t, 1), fat: db >= 0 });
    }
  }
  const last = trend[trend.length - 1];
  const h = hover !== null ? trend[hover] : null;
  const months = (p: { held: number; sold90: number }) => (p.sold90 > 0 ? ((p.held / p.sold90) * 3).toFixed(1) : '–');
  const labelGap = Math.abs(y(last.held) - y(last.sold90)) < 16;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="text-sm font-medium text-slate-700">Stock held against stock sold</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: FAT }} />Fat: more than 90 days of stock</span>
        <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: THIN }} />Thin: selling faster than we hold</span>
      </div>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" onPointerLeave={() => setHover(null)}
          aria-label="Stock held at each month end against qty sold in the 90 days before it.">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#64748b">{n(t)}</text>
            </g>
          ))}
          {body.map((b, i) => <path key={i} d={b.d} fill={b.fat ? FAT : THIN} />)}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ph} stroke="#cbd5e1" />}
          <path d={path('sold90')} fill="none" stroke={SOLD} strokeWidth={2} />
          <path d={path('held')} fill="none" stroke={BLUE} strokeWidth={2.5} />
          {trend.map((p, i) => {
            const m = Number(p.month.slice(5, 7));
            return (
              <text key={p.month} x={x(i)} y={M.t + ph + 16} textAnchor="middle" fontSize={11} fill="#64748b">
                {MONTHS[m - 1].slice(0, 1)}
                {(i === 0 || m === 1) && <tspan x={x(i)} dy={13}>{p.month.slice(0, 4)}</tspan>}
              </text>
            );
          })}
          <text x={x(trend.length - 1) + 10} y={y(last.held)} dy={labelGap && last.held < last.sold90 ? '1.2em' : '0.32em'}
            fontSize={12} fontWeight={600} fill={BLUE}>Held {n(last.held)}</text>
          <text x={x(trend.length - 1) + 10} y={y(last.sold90)} dy={labelGap && last.held >= last.sold90 ? '1.2em' : '0.32em'}
            fontSize={12} fill={SOLD}>Sold 90 days {n(last.sold90)}</text>
          {trend.map((p, i) => (
            <rect key={p.month} x={x(i) - step / 2} y={M.t} width={Math.max(step, 1)} height={ph} fill="transparent"
              onPointerEnter={() => setHover(i)} />
          ))}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: `${(x(hover!) / W) * 100}%`, transform: hover! > trend.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
            <div className="font-medium text-slate-800">
              End {MONTHS[Number(h.month.slice(5, 7)) - 1]} {h.month.slice(0, 4)}{h.partial ? ' (today)' : ''}
            </div>
            <div className="mt-1 text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{n(h.held)}</span> in stock</div>
            <div className="text-slate-600"><span className="font-semibold tabular-nums text-slate-900">{n(h.sold90)}</span> sold in the 90 days before</div>
            <div className="mt-1 text-slate-500">{months(h)} months of stock</div>
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// NOT KEEPING UP — styles with more pairs past 90 days than they sold in the last 90 (server's rule and order). Two facts side by side.
// GROUPID opens the Shopify price drill; Back returns here.
// -------------------------------------------------------------------------------------------------------------------------------------
function BehindList({ top }: { top: StockPositionData['act']['top'] }) {
  const self = encodeURIComponent('/analytics/stock-position');
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm sm:col-span-2">
      <div className="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
        Most 90-day stock, selling slower than that
      </div>
      {top.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400">None.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-4 py-2 text-left font-semibold">Style</th>
              <th className="px-4 py-2 text-right font-semibold">In stock</th>
              <th className="px-4 py-2 text-right font-semibold">Past 90 days</th>
              <th className="px-4 py-2 text-right font-semibold">Sold 90 days</th>
            </tr>
          </thead>
          <tbody>
            {top.map((s) => (
              <tr key={s.groupid} className="border-b border-slate-100 text-slate-700 last:border-0">
                <td className="whitespace-nowrap px-4 py-1.5">
                  <Link href={`/pricing/style/${encodeURIComponent(s.groupid)}?from=${self}`} title={s.title ?? undefined}
                    className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                    {s.groupid}
                  </Link>
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">{n(s.units)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums font-semibold text-slate-900">{n(s.past90)}</td>
                <td className="px-4 py-1.5 text-right tabular-nums">{n(s.sold_90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
