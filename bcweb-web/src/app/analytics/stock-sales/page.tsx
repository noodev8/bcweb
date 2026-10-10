'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-sales  (Reports — Stock vs Sales)
=======================================================================================================================================
Purpose: Is the stock we buy shifting? The owner's read on whether to slow ordering down or speed it up (2026-10-09: "Just sales
         against stock position"). Replaced the Stock Position gauge (a count of "alive" products, recorded by an Update button).

HIGH LEVEL ON PURPOSE (owner, 2026-10-09)
         The first cut had weekly panels, a Shopify/Amazon/Shop split, a hover readout, a Week|Month switch on the chart and a full
         table, and the owner's verdict was "too many things going on — I really want it simple". So, top to bottom:
           1. THE TRACK — three boxes SELLING (biggest) | SITTING | NEW (60-day window, adds to 100%; boxes, not a bar)
           2. the sitting styles — the "crap list" the owner works to keep the track up
           3. (HIDDEN, lib/features.ts STOCK_SALES_FLOW) a monthly chart — closing stock line over sold columns
           4. (HIDDEN, same switch) the numbers as a list, Month | Week, with % sold (also the chart's table view)
         Selling % leads (owner, 2026-10-10: "use the positive 87%... I don't want this number to go too low"), chosen knowing it reads
         generously — a style's WHOLE stock counts as selling if it sold one pair in 60 days — so it's labelled "in styles that sold",
         never "% sold". The split is TODAY only — per-style stock history isn't stored and the owner doesn't want it stored.
         The top was three numbers (stock, sold 30d, % sold 30d) plus a 60-day sitting % until 2026-10-10 — owner: the 30- and 60-day
         numbers side by side "feel mixed". Sold/% sold measure flow, not stock, so they can't be part of a split that adds to 100%;
         they live in the list (the current month, so far, is its top row).
         Per-channel detail already lives on the Sales report; don't grow this page back into it.

NO EXCESS (removed 2026-10-10, owner: "Let's not have anything regarding EXCESS")
         A depth card (stock as months of each style's own sales), an "excess units" number (stock beyond 6 months' need for
         Birkenstock, 2 for the rest), a by-brand card, a Repricing excess list, a Google Ads excess chip and a Shopify clearance tag
         built on them all went the same day. Every version of the rule forecast from past pace, and seasonal buying beats that: a
         Zermatt bought in August for the winter run, selling well, read as 29 excess and a clearance candidate. 12-month pace, 30/90-day
         pace, last year's same months and 12 months' need were all tried and rejected; so was "aged stock" (owner: "I can easily order
         something I feel will sell well"). The code is in git history (commits f0ed513, e4f91fd, dd28eb4). Don't put a stock-needs rule
         back without the owner.

CHART (back 2026-10-10, owner asked for it)
         A monthly stock-line-over-sold-columns chart was removed on 2026-10-09 ("it just looks obvious") and brought back the next day
         once the excess cards were gone. Monthly only — the Month | Week switch belongs to the list. ONE units axis: stock and sold are
         the same unit (pairs of shoes), so a shared scale is honest, never a second y-axis. The open month's column is faded ("so far").

% SOLD — THE OWNER'S MEASURE ("buy it, sell it, quick")
         Sold in the period ÷ stock at the end of it. It swings with the season (≈8% in January, ≈42% in June 2026), so it is read down
         the list against the same month a year earlier, not against a fixed target. No verdict tile: the owner asked for the list.

SITTING (2026-10-10, owner: "Stock comes in, goes out, happy. Sits, not happy so I push it.")
         Stock in styles with no sale on any channel for 60 days (deliveries ignored — owner: "my fault if I'm still ordering while
         they are not selling"), except NEW products — created under 60 days ago and not yet sold (same window; NOT Repricing's 90-day NEW status) — which
         are their own part of the split and off the list; the rest is SELLING. The top split and the list both come from GET /analytics-stock-sitting, LIVE
         stock — so the top number can differ from the chart's latest point (last night's stock_daily reading) by today's movement.
         The list: most pairs first, GROUPID leading with the title on hover, each opening its pricing drill; pairs are one number, no
         Amazon split (owner: keep the display clean). Sitting is the number to push down; the list is what to promote or clear. A
         fact, not a forecast (rules and the why in routes/analytics-stock-sitting.js) — not the excess rules coming back.

Guarded by AppShell. Consumes GET /analytics-stock-sitting, and GET /analytics-stock-sales only while STOCK_SALES_FLOW is on.
=======================================================================================================================================
*/

import { useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { STOCK_SALES_FLOW } from '@/lib/features';
import { getStockSales, getStockSitting, StockSalesPeriod, StockSittingData } from '@/lib/api';

const n = (v: number) => v.toLocaleString('en-GB');

// 'YYYY-MM-DD' -> parts without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
const dayLabel = (s: string) => `${ymd(s).d} ${MONTHS[ymd(s).m - 1]}`;
const monthLabel = (s: string) => `${MONTHS[ymd(s).m - 1]} ${ymd(s).y}`;
const weekLabel = (s: string) => `${dayLabel(s)} ${String(ymd(s).y).slice(2)}`; // the Monday the week starts

export default function StockSalesPage() {
  // The flow half (chart + Month | Week list) is behind STOCK_SALES_FLOW; switched off, its query never runs (null key = don't fetch).
  const q = useApiQuery(STOCK_SALES_FLOW ? 'analytics-stock-sales' : null, () => getStockSales());
  const d = q.data;
  const sq = useApiQuery('analytics-stock-sitting', () => getStockSitting());
  const sit = sq.data;
  const stale = d?.latest && d.latest.date < d.expected_date;

  return (
    <AppShell backHref="/analytics" backLabel="Reports">
      {(sq.isLoading || q.isLoading) && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}

      {stale && (
        <div className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The latest stock reading is {dayLabel(d!.latest!.date)} — the nightly job hasn&rsquo;t recorded {dayLabel(d!.expected_date)}.
          Check Bclog for a &ldquo;Stock Daily&rdquo; entry.
        </div>
      )}

      {sq.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{sq.error.message}</div>}
      {sit && <StockSplit data={sit} />}
      {sit && <SittingList data={sit} />}

      {/* Background: how stock and sales flow through the year — HIDDEN while STOCK_SALES_FLOW is false (lib/features.ts). */}
      {d && d.months.length > 0 && <div className="mt-8"><Chart months={d.months} /></div>}
      {d && d.months.length > 0 && <PeriodList months={d.months} weeks={d.weeks} />}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// STOCK SPLIT — the top of the page: stock now, split three ways that add up to the whole, as THREE BOXES — SELLING (sold in `days`) |
// SITTING | NEW (unsold but created under `new_days` ago — giving it a chance; last, owner 2026-10-10). Live stock, from the same read
// as the sitting list, so the parts and the total always agree. Each % is rounded and selling takes the remainder, so they make 100.
// Boxes, not a bar (owner, 2026-10-10: "the blue overrides too many") — neutral slate, no series colour; SELLING is the track, so its
// number is the biggest on the page.
// SELLING % — the owner's number, keep it high ("I don't want this number to go too low"); the sitting list below is how it's worked
// up. Worded "in styles that sold" on purpose: a style's WHOLE stock counts as selling if it sold one pair in the window, so it is not
// "% of stock sold".
// -------------------------------------------------------------------------------------------------------------------------------------
function StockSplit({ data }: { data: StockSittingData }) {
  const total = data.total_units;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const newPct = pct(data.new_units);
  const sitPct = pct(data.sitting_units);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <SplitBox hero label="of stock selling" pct={total ? 100 - newPct - sitPct : 0}
        detail={`${n(data.selling_units)} of ${n(total)} pairs in styles that sold in the last ${data.days} days`} />
      <SplitBox label="sitting" pct={sitPct}
        detail={`${n(data.sitting_units)} pairs — no sale in ${data.days} days`} />
      <SplitBox label="new" pct={newPct}
        detail={`${n(data.new_units)} pairs — not sold yet, under ${data.new_days} days old`} />
    </div>
  );
}

function SplitBox({ hero, label, pct, detail }: { hero?: boolean; label: string; pct: number; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-baseline gap-2">
        <span className={`font-semibold leading-none tabular-nums ${hero ? 'text-6xl text-slate-900' : 'text-4xl text-slate-700'}`}>
          {pct}%
        </span>
        <span className={hero ? 'text-base font-medium text-slate-700' : 'text-sm text-slate-500'}>{label}</span>
      </div>
      <div className="mt-2 text-sm text-slate-500">{detail}</div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// CHART — monthly closing stock (line) over units sold (columns), one shared units axis. Colours are the dataviz reference palette's
// categorical slots 1 and 2 (a validated pair); every number is also in the list below, which is the chart's table view. Hover a month
// for its readout. Text stays in slate ink, never the series colour.
// -------------------------------------------------------------------------------------------------------------------------------------
const STOCK_COLOR = '#2a78d6';
const SOLD_COLOR = '#eb6834';

// A 1/2/5 x 10^n step, so the axis reads in round numbers.
function niceStep(raw: number) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// A column with a 4px rounded top and a square foot on the baseline.
function columnPath(x: number, top: number, w: number, base: number) {
  const r = Math.min(4, w / 2, base - top);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

function Chart({ months }: { months: StockSalesPeriod[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 260, M = { t: 12, r: 12, b: 34, l: 52 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const max = Math.max(1, ...months.map((p) => Math.max(p.stock ?? 0, p.sold)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const base = M.t + ph;
  const y = (v: number) => base - (v / top) * ph;
  const band = pw / months.length;
  const cx = (i: number) => M.l + band * i + band / 2;
  const colW = Math.min(24, band * 0.55);

  // The stock line, broken where a month has no reading.
  let line = '';
  months.forEach((p, i) => {
    if (p.stock === null) return;
    const prevMissing = i === 0 || months[i - 1].stock === null;
    line += `${prevMissing ? 'M' : 'L'}${cx(i)},${y(p.stock)} `;
  });

  const h = hover !== null ? months[hover] : null;
  const pct = h && h.stock ? Math.round((h.sold / h.stock) * 100) : null;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 rounded" style={{ backgroundColor: STOCK_COLOR }} />In stock (month end)
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-3 w-2.5 rounded-t-sm" style={{ backgroundColor: SOLD_COLOR }} />Sold in the month
        </span>
      </div>

      <div className="relative mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }} role="img"
          aria-label="Monthly stock at month end and units sold. The same numbers are in the list below."
          onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth={1} />
              <text x={M.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#64748b">{n(t)}</text>
            </g>
          ))}

          {/* the hovered month's band, behind the marks */}
          {hover !== null && <rect x={M.l + band * hover} y={M.t} width={band} height={ph} fill="#f1f5f9" />}

          {months.map((p, i) => (
            <path key={p.start} d={columnPath(cx(i) - colW / 2, y(p.sold), colW, base)} fill={SOLD_COLOR}
              opacity={p.partial ? 0.45 : 1} />
          ))}

          <path d={line} fill="none" stroke={STOCK_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && h.stock !== null && (
            <circle cx={cx(hover!)} cy={y(h.stock)} r={4.5} fill={STOCK_COLOR} stroke="#ffffff" strokeWidth={2} />
          )}

          {months.map((p, i) => {
            const { m, y: yr } = ymd(p.start);
            return (
              <text key={p.start} x={cx(i)} y={base + 16} textAnchor="middle" fontSize={11} fill="#64748b">
                {MONTHS[m - 1]}
                {(i === 0 || m === 1) && <tspan x={cx(i)} dy={13}>{yr}</tspan>}
              </text>
            );
          })}

          {/* hit targets: the whole month band, bigger than any mark */}
          {months.map((p, i) => (
            <rect key={p.start} x={M.l + band * i} y={M.t} width={band} height={ph} fill="transparent"
              onPointerEnter={() => setHover(i)} />
          ))}
        </svg>

        {h && (
          <div className="pointer-events-none absolute top-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(cx(hover!) / W) * 100}%`,
              transform: hover! > months.length / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}>
            <div className="font-medium text-slate-800">{monthLabel(h.start)}{h.partial ? ' (so far)' : ''}</div>
            <div className="mt-1 flex items-center gap-2 text-slate-600">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: STOCK_COLOR }} />
              <span className="font-semibold tabular-nums text-slate-900">{h.stock === null ? '—' : n(h.stock)}</span> in stock
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span className="inline-block h-0.5 w-3 rounded" style={{ backgroundColor: SOLD_COLOR }} />
              <span className="font-semibold tabular-nums text-slate-900">{n(h.sold)}</span> sold
            </div>
            {pct !== null && (
              <div className="mt-1 text-slate-500"><span className="font-semibold tabular-nums text-slate-900">{pct}%</span> sold</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// LIST — the numbers, newest first, Month | Week, so the seasons can be read down the page (owner: "I can see how it fluctuates
// through the seasons"). Stock history starts Oct 2025, so the list grows a row a period — capped at the newest LIST_ROWS so the card
// never scrolls inside itself (owner: no scroll bar on this grid).
// -------------------------------------------------------------------------------------------------------------------------------------
const LIST_ROWS = 24;

function PeriodList({ months, weeks }: { months: StockSalesPeriod[]; weeks: StockSalesPeriod[] }) {
  const [grain, setGrain] = useState<'month' | 'week'>('month');
  const rows = (grain === 'month' ? months : weeks).slice(-LIST_ROWS).reverse();
  const label = grain === 'month' ? monthLabel : weekLabel;

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-end border-b border-slate-100 px-4 py-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {(['month', 'week'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrain(g)}
              aria-pressed={grain === g}
              className={
                'rounded-md px-3 py-1 text-sm font-medium capitalize transition ' +
                (grain === g ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-5 py-2.5 text-left font-semibold">{grain === 'month' ? 'Month' : 'Week'}</th>
            <th className="px-5 py-2.5 text-right font-semibold">In stock</th>
            <th className="px-5 py-2.5 text-right font-semibold">Sold</th>
            <th className="px-5 py-2.5 text-right font-semibold">% sold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const pct = p.stock ? Math.round((p.sold / p.stock) * 100) : null;
            return (
              <tr key={p.start} className={`border-b border-slate-100 last:border-0 ${p.partial ? 'text-slate-400' : 'text-slate-700'}`}>
                <td className="whitespace-nowrap px-5 py-2">
                  {label(p.start)}
                  {p.partial && <span className="ml-2 text-xs">so far</span>}
                </td>
                <td className="px-5 py-2 text-right tabular-nums">{p.stock === null ? '—' : n(p.stock)}</td>
                <td className="px-5 py-2 text-right tabular-nums">{n(p.sold)}</td>
                <td className={`px-5 py-2 text-right tabular-nums ${p.partial ? '' : 'font-semibold text-slate-900'}`}>
                  {pct === null ? '—' : `${pct}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// SITTING — the styles behind the fourth number: held, with no sale for `days`. Most pairs first; each opens its pricing
// drill (and comes back here). The whole set, not a top-N — the count is the job.
// -------------------------------------------------------------------------------------------------------------------------------------
const SELF = encodeURIComponent('/analytics/stock-sales');

function SittingList({ data }: { data: StockSittingData }) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-800">
        Sitting — no sale in {data.days} days
        <span className="font-normal text-slate-500">
          {' · '}{data.styles.length} {data.styles.length === 1 ? 'style' : 'styles'}, {n(data.sitting_units)} pairs
        </span>
      </div>
      {data.styles.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">Nothing sitting.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 text-left font-semibold">Style</th>
                <th className="px-5 py-2.5 text-left font-semibold">Brand</th>
                <th className="px-5 py-2.5 text-right font-semibold">Pairs</th>
                <th className="px-5 py-2.5 text-right font-semibold">Last sale</th>
                <th className="px-5 py-2.5 text-right font-semibold">Days</th>
              </tr>
            </thead>
            <tbody>
              {data.styles.map((s) => (
                <tr key={s.groupid} className="border-b border-slate-100 text-slate-700 last:border-0">
                  <td className="px-5 py-2">
                    <Link href={`/pricing/style/${encodeURIComponent(s.groupid)}?from=${SELF}`} title={s.title ?? undefined}
                      className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                      {s.groupid}
                    </Link>
                  </td>
                  <td className="px-5 py-2 text-slate-500">{s.brand || '—'}</td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    <span className="font-semibold text-slate-900">{n(s.units)}</span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 text-right tabular-nums">{s.last_sale ? weekLabel(s.last_sale) : 'never'}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{s.idle_days ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
