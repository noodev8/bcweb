'use client';
/*
=======================================================================================================================================
Page: /analytics/stock-sales  (SLOW — on screen since 2026-10-12, reached ONLY from the Slow card on Winners, with no menu entry
      (owner: "Replace all 'Selling vs Sitting' words and navigation to 'Slow'. Remove the menu option for Selling v Sitting
      completely"). Was Slow (2026-10-10), before that Stock vs Sales — the route keeps its old name.)
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
         The list: most pairs first, GROUPID leading with the title on hover, GROUPID opens the Shopify price drill, sortable headers; "Reprice →" opens them on Repricing (see SittingList); the clearance collection is the owner's choice — each row shows In collection / Not in with
         Add / Remove, and nothing goes in or out on its own (2026-10-14, see THE COLLECTION above SittingList); pairs are one number, no
         Amazon split (owner: keep the display clean). Sitting is the number to push down; the list is what to promote or clear. A
         fact, not a forecast (rules and the why in routes/analytics-stock-sitting.js) — not the excess rules coming back.
         Cut hides ticked rows from the display only, until Reset or a reload (2026-10-14) — nothing is stored and no action skips them.

ARRIVAL FROM REPRICING (2026-10-12, owner: "WINNERS needs a card for CLEARANCE screen navigation and back"; the card is "Slow").
         Repricing's Status tab (the owner's "WINNERS" screen) has a Slow card that opens this page with ?from=/segments&back=Winners;
         ← Back then returns there, and the origin rides along on every link out (drill, Reprice, Google Ads) so coming back through
         them keeps it. With no ?from= (a bookmark) ← Back still goes to Winners.

Guarded by AppShell. Consumes GET /analytics-stock-sitting, GET /shopify-clearance-list, POST /shopify-clearance-apply,
POST /shopify-clearance-set, POST /pricing-apply (Remove's optional price), and GET /analytics-stock-sales only while
STOCK_SALES_FLOW is on.

=======================================================================================================================================
*/

import { Fragment, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SortableTh, useTableSort } from '@/components/SortableTh';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { STOCK_SALES_FLOW } from '@/lib/features';
import {
  getStockSales, getStockSitting, applyClearanceTags, StockSalesPeriod, StockSittingData,
  getClearanceCollection, setClearance, applyPrice, ClearanceCollectionItem,
} from '@/lib/api';

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

// Where ← Back goes: ?from= when a screen sent us here, else the Slow card on Winners — the only way in since the menu entries went
// (2026-10-12). Same-site paths only.
function useOrigin() {
  const sp = useSearchParams();
  const raw = sp.get('from');
  const from = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
  return { from, back: from ? sp.get('back') || 'Back' : null };
}

// This page's own path with the sort and the origin kept, so a link out (drill, Reprice, Google Ads) comes back to it as it was left.
function selfPath(origin: { from: string | null; back: string | null }, sort?: string) {
  const q = new URLSearchParams();
  if (sort) q.set('sort', sort);
  if (origin.from) { q.set('from', origin.from); q.set('back', origin.back || 'Back'); }
  const qs = q.toString();
  return `/analytics/stock-sales${qs ? `?${qs}` : ''}`;
}

// useSearchParams (the ← Back origin) needs a Suspense boundary for Next's build.
export default function StockSalesPage() {
  return (
    <Suspense fallback={null}>
      <StockSalesBody />
    </Suspense>
  );
}

function StockSalesBody() {
  const origin = useOrigin();
  // The flow half (chart + Month | Week list) is behind STOCK_SALES_FLOW; switched off, its query never runs (null key = don't fetch).
  const q = useApiQuery(STOCK_SALES_FLOW ? 'analytics-stock-sales' : null, () => getStockSales());
  const d = q.data;
  const sq = useApiQuery('analytics-stock-sitting', () => getStockSitting());
  const sit = sq.data;
  // What is in the clearance collection — read live from Shopify, its own query so a slow Shopify never holds up the list.
  const cq = useApiQuery('shopify-clearance-list', () => getClearanceCollection());
  const stale = d?.latest && d.latest.date < d.expected_date;

  return (
    <AppShell backHref={origin.from ?? '/segments#slow'} backLabel={origin.back ?? 'Winners'}>
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
      {sit && (
        <SittingList
          data={sit}
          collection={cq.data ?? null}
          collectionError={cq.error ? cq.error.message : null}
          onCollectionChange={() => cq.mutate()}
        />
      )}

      {/* Background: how stock and sales flow through the year — HIDDEN while STOCK_SALES_FLOW is false (lib/features.ts). */}
      {d && d.months.length > 0 && <div className="mt-8"><Chart months={d.months} /></div>}
      {d && d.months.length > 0 && <PeriodList months={d.months} weeks={d.weeks} />}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// STOCK SPLIT — the top of the page: stock now, split three ways that add up to the whole, as THREE BOXES — SITTING | SELLING (sold in `days`) |
// NEW (unsold but created under `new_days` ago — giving it a chance; last, owner 2026-10-10). Live stock, from the same read
// as the sitting list, so the parts and the total always agree. Each % is rounded and selling takes the remainder, so they make 100.
// Boxes, not a bar (owner, 2026-10-10: "the blue overrides too many") — neutral slate, no series colour; SITTING is the
// headline, so its number is the biggest on the page.
// SITTING % LEADS since 2026-10-12 (owner: "make the 10% as the MAIN headline figure. No longer about the ones that are selling") —
// the page is Slow now, and the number to push down is the headline; the sitting list below is how it's worked down. It was SELLING %
// first (owner, 2026-10-10: "I don't want this number to go too low"). Selling keeps the remainder so the three still make 100.
// SELLING is worded "in styles that sold" on purpose: a style's WHOLE stock counts as selling if it sold one pair in the window, so it is not
// "% of stock sold".
// -------------------------------------------------------------------------------------------------------------------------------------
function StockSplit({ data }: { data: StockSittingData }) {
  const total = data.total_units;
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const newPct = pct(data.new_units);
  const sitPct = pct(data.sitting_units);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Numbers only, lined up (owner, 2026-10-12: "Simply interested in the numbers and want them lined up") — just "N pairs";
          the 60-day rule is on the Winners card's header. Boxes align to the BOTTOM so the % and pairs lines sit level across
          all three even though slow's number is the biggest. */}
      <SplitBox hero label="slow" pct={sitPct}
        detail={`${n(data.sitting_units)} pairs`} />
      <SplitBox label="selling" pct={total ? 100 - newPct - sitPct : 0}
        detail={`${n(data.selling_units)} pairs`} />
      <SplitBox label="new" pct={newPct}
        detail={`${n(data.new_units)} pairs`} />
    </div>
  );
}

function SplitBox({ hero, label, pct, detail }: { hero?: boolean; label: string; pct: number; detail: string }) {
  return (
    <div className="flex flex-col justify-end rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-baseline gap-2">
        {/* No tabular-nums here: a lone figure needs no column alignment, and the tabular "1" is padded to a full digit width, which
            pushed "10%" visibly right of the pairs line under it (owner, 2026-10-12). -ml-0.5 on the 60px hero takes off the rest of
            the glyph's side bearing so its ink starts where the pairs line does. */}
        <span className={`font-semibold leading-none ${hero ? '-ml-0.5 text-6xl text-slate-900' : 'text-4xl text-slate-700'}`}>
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
// SITTING — the styles behind the Sitting box: held, with no sale on any channel for `days`. Most pairs first. The whole set, not a
// top-N — the count is the job.
// ACT ON THE LIST, NOT ROW BY ROW (owner, 2026-10-10: "SHOPIFY only. My intention is to clear the crap. I will want to be able to price
// them"). The header's "Reprice →" opens the same styles as a Shopify Repricing list (/pricing/sitting?by=sitting — server
// /pricing-sitting-list reads the same rule), with the bulk bar and the per-style drill. Same tab, Due OFF (most sitting styles carry a
// review date ahead — 49 of 52 at build time — and Due on would hide them), ← Back returns here.
// Each GROUPID opens that style's SHOPIFY price drill (/pricing/style), same tab, ← Back returns here with the sort kept — taken off
// while the owner decided, put back the same day ("Put the link back on groupid to the Shopify Price screen"). Title on hover.
// "Google Ads →" opens the Google Ads grid narrowed to these styles by a "Sitting" chip (/google-ads?sitting=1, same tab, ← Back
// returns here with the sort kept) — owner: "send me to the screen with the list already filtered, for me to choose a campaign if I
// wanted". Nothing is selected or moved there; see SITTING ARRIVAL in google-ads/page.tsx.
// -------------------------------------------------------------------------------------------------------------------------------------
const repriceHref = (self: string) =>
  `/pricing/sitting?by=sitting&pending=1&from=${self}&back=${encodeURIComponent('Slow')}`;

// Sortable headers (components/SortableTh — the Repricing lists' own): opens in the server's order (most pairs first); a click sorts,
// a second reverses. The sort sits in the URL (?sort=), so ← Back from Repricing returns to it. Never-sold styles count as the longest
// wait on Days (Infinity) rather than sinking as blanks; on Last sale they sink ("never" has no date).
// useTableSort reads useSearchParams, so the list renders inside a Suspense boundary (Next's build requires one).
//
// THE COLLECTION (2026-10-14, owner: "The slow screen simply shows what is SLOW and whether it is in a clearance collection or not. Then
// its up to me to choose what is in or out the collection. Simple."). Every row carries an In collection / Not in pill and its own Add
// or Remove; tick rows to Add / Remove in bulk. Nothing goes in or out by itself — "Update collection" still adds every slow style
// not yet in, but never removes (a sale used to untag a style, which pulled 9 out mid-campaign while their 50% price stayed). Styles
// still IN the collection that have sold (no longer slow) get their own section, so they can be seen and taken out.
// Remove on one row opens a small inline form with an OPTIONAL new price ("Perhaps continue to allow repricing if I remove from a
// collection"): the tag comes off (POST /shopify-clearance-set), then, if a price was typed, a normal W1 (applyPrice) with the note
// "Removed from clearance" and no review date. Any other pricing goes through the GROUPID link to the price drill, as everywhere.
//
// CUT is DISPLAY ONLY (owner, 2026-10-14: "all it does is simply remove from the display. I need a reset/refresh to bring all back").
// Tick rows and Cut, or click a row's own ×, and they leave the screen; Reset (or a reload) brings every row back. Nothing is stored and no action skips a cut row.
// Until that day it was a stored team-wide mark that Update collection / Reprice / Google Ads skipped — removed with its columns
// ("Cut is mixing the logic"); don't bring the storage back.
// Click handlers only, never a useEffect (docs/maintenance-notes.md).
interface SittingListProps {
  data: StockSittingData;
  collection: ClearanceCollectionItem[] | null;   // null while loading or if Shopify couldn't be read — pills hidden, list still works
  collectionError: string | null;
  onCollectionChange: () => void;
}

const REMOVE_NOTE = 'Removed from clearance';

function SittingList(props: SittingListProps) {
  return (
    <Suspense fallback={null}>
      <SittingListBody {...props} />
    </Suspense>
  );
}

function SittingListBody({ data, collection, collectionError, onCollectionChange }: SittingListProps) {
  const { sorted, sort, onSort } = useTableSort(data.styles, {
    groupid: (s) => s.groupid,
    brand: (s) => s.brand,
    units: (s) => s.units,
    last_sale: (s) => s.last_sale,
    days: (s) => s.idle_days ?? Infinity,
  });
  const th = { sort, onSort };
  // This page's own URL WITH the current sort (and the Repricing origin, if any), so ← Back from a link out lands on the list as it was left.
  const origin = useOrigin();
  const self = encodeURIComponent(selfPath(origin, sort ? `${sort.key}.${sort.dir}` : undefined));

  // Collection membership by groupid; the members that are no longer slow (they sold), most pairs first.
  const inColl = new Map((collection ?? []).filter((c) => c.groupid).map((c) => [c.groupid as string, c]));
  const soldAll = (collection ?? []).filter((c) => !c.sitting).sort((a, b) => (b.units ?? 0) - (a.units ?? 0));

  // CUT — display only (see above). Applies to both sections.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const rows = sorted.filter((s) => !hidden.has(s.groupid));
  const sold = soldAll.filter((c) => !hidden.has(c.groupid ?? c.handle));

  // Ticked rows — by groupid, or the handle for a hand-tagged product we don't know (those can only be cut, not added / removed).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const visibleKeys = [...rows.map((s) => s.groupid), ...sold.map((c) => c.groupid ?? c.handle)];
  const pickedKeys = visibleKeys.filter((k) => picked.has(k));
  const pickedIn = pickedKeys.filter((k) => inColl.has(k));
  const pickedOut = pickedKeys.filter((k) => !inColl.has(k) && rows.some((s) => s.groupid === k));
  const allPicked = visibleKeys.length > 0 && pickedKeys.length === visibleKeys.length;
  function togglePick(k: string) {
    setPicked((p) => { const nx = new Set(p); if (nx.has(k)) nx.delete(k); else nx.add(k); return nx; });
  }
  function cutPicked() {
    setHidden((h) => new Set([...h, ...pickedKeys]));
    setPicked(new Set());
  }
  // The row's own × — cut just that one line, no ticking (owner, 2026-10-14: "cut single lines quickly"). Same display-only cut.
  function cutOne(k: string) {
    setHidden((h) => new Set([...h, k]));
    setPicked((p) => { if (!p.has(k)) return p; const nx = new Set(p); nx.delete(k); return nx; });
    if (removing === k) setRemoving(null);
  }

  // ADD / REMOVE — one row or the ticked ones. A message says what happened; the collection is re-read from Shopify after.
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);   // groupid with the Remove-with-price form open
  function reset() {
    setHidden(new Set());
    setPicked(new Set());
    setMsg(null);
  }
  async function setIn(ids: string[], inCollection: boolean) {
    if (ids.length === 0) return;
    setBusy(true); setMsg(null);
    const r = await setClearance(ids, inCollection);
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Update failed', bad: true }); return; }
    const d = r.data;
    const failed = d.failed.length ? ` · ${d.failed.length} failed (${d.failed.map((f) => f.groupid).join(', ')})` : '';
    setMsg({ text: `${inCollection ? '+' : '−'}${d.done.length} ${inCollection ? 'added' : 'removed'}${failed}`, bad: d.failed.length > 0 });
    setPicked(new Set());
    onCollectionChange();
  }
  // UPDATE COLLECTION — one click adds every slow style not yet in (owner, 2026-10-10: one click, no preview). Never removes.
  async function addAll() {
    setBusy(true); setMsg(null);
    const r = await applyClearanceTags();
    setBusy(false);
    if (!(r.success && r.data)) { setMsg({ text: r.error || 'Update failed', bad: true }); return; }
    const d = r.data;
    const failed = d.failed.length ? ` · ${d.failed.length} failed, try again` : '';
    setMsg({ text: `+${d.added.length} added${failed}`, bad: d.failed.length > 0 });
    onCollectionChange();
  }

  const link = 'text-sm font-medium text-slate-600 hover:text-slate-900 hover:underline disabled:opacity-50';
  const pickLink = 'text-sm font-medium text-slate-900 hover:underline disabled:opacity-50';
  const rowAction = 'ml-3 text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline disabled:opacity-50';
  function pill(groupid: string) {
    if (!collection) return null;
    return inColl.has(groupid)
      ? <span className="ml-2 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-white">In collection</span>
      : <span className="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-400">Not in</span>;
  }
  function rowButton(groupid: string) {
    if (!collection || removing === groupid) return null;
    return inColl.has(groupid)
      ? <button type="button" onClick={() => setRemoving(groupid)} disabled={busy} className={rowAction}>Remove</button>
      : <button type="button" onClick={() => setIn([groupid], true)} disabled={busy} className={rowAction}>Add</button>;
  }
  function removeRow(groupid: string) {
    if (removing !== groupid) return null;
    return (
      <tr className="border-b border-slate-100 bg-slate-50">
        <td colSpan={7} className="px-4 py-2">
          <RemoveForm groupid={groupid} price={inColl.get(groupid)?.price ?? null}
            onCancel={() => setRemoving(null)}
            onDone={(text) => { setRemoving(null); setMsg({ text, bad: false }); onCollectionChange(); }} />
        </td>
      </tr>
    );
  }
  function cutCell(k: string) {
    return (
      <td className="w-8 py-2 pl-0 pr-4 text-right">
        <button type="button" onClick={() => cutOne(k)} aria-label={`Cut ${k}`} title="Cut this row (Reset brings it back)"
          className="px-1 text-base leading-none text-slate-300 hover:text-slate-700">&times;</button>
      </td>
    );
  }
  function checkbox(k: string) {
    return (
      <td className="w-8 py-2 pl-4 pr-0">
        <input type="checkbox" aria-label={`Select ${k}`} checked={picked.has(k)} disabled={busy} onChange={() => togglePick(k)}
          className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400" />
      </td>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-100 px-5 py-3">
        <div className="text-sm text-slate-500">
          {collection && <>{collection.length} in collection</>}
          {hidden.size > 0 && <>{collection && ' · '}{hidden.size} cut</>}
          {collectionError && <span className="text-red-700">Collection: {collectionError}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {msg && <span className={`text-sm ${msg.bad ? 'text-red-700' : 'text-slate-500'}`}>{msg.text}</span>}
          {/* What the ticked rows can do — only the buttons that apply. */}
          {pickedOut.length > 0 && (
            <button type="button" onClick={() => setIn(pickedOut, true)} disabled={busy} className={pickLink}>Add {pickedOut.length}</button>
          )}
          {pickedIn.length > 0 && (
            <button type="button" onClick={() => setIn(pickedIn, false)} disabled={busy} className={pickLink}>Remove {pickedIn.length}</button>
          )}
          {pickedKeys.length > 0 && (
            <button type="button" onClick={cutPicked} disabled={busy} className={pickLink}>Cut {pickedKeys.length}</button>
          )}
          {hidden.size > 0 && <button type="button" onClick={reset} className={link}>Reset</button>}
          <button type="button" onClick={addAll} disabled={busy} className={link}>{busy ? 'Updating…' : 'Update collection'}</button>
          {data.styles.length > 0 && (
            <>
              <Link href={`/google-ads?sitting=1&from=${self}&back=${encodeURIComponent('Slow')}`} className={link}>Google Ads &rarr;</Link>
              <Link href={repriceHref(self)} className={link}>Reprice &rarr;</Link>
            </>
          )}
        </div>
      </div>
      {rows.length === 0 && sold.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">{hidden.size > 0 ? 'Every row is cut — Reset to bring them back.' : 'Nothing slow.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="w-8 py-2 pl-4 pr-0">
                  <input type="checkbox" aria-label="Select all" checked={allPicked} disabled={visibleKeys.length === 0 || busy}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(visibleKeys))}
                    className="h-4 w-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400" />
                </th>
                <SortableTh {...th} sortKey="groupid" label="Style" firstDir="asc" />
                <SortableTh {...th} sortKey="brand" label="Brand" firstDir="asc" />
                <SortableTh {...th} sortKey="units" label="Pairs" align="right" />
                <SortableTh {...th} sortKey="last_sale" label="Last sale" align="right" />
                <SortableTh {...th} sortKey="days" label="Days" align="right" />
                <th className="w-8 py-2 pl-0 pr-4" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <Fragment key={s.groupid}>
                  <tr className="border-b border-slate-100 text-slate-700 last:border-0">
                    {checkbox(s.groupid)}
                    <td className="whitespace-nowrap px-4 py-2">
                      <Link href={`/pricing/style/${encodeURIComponent(s.groupid)}?from=${self}`} title={s.title ?? undefined}
                        className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                        {s.groupid}
                      </Link>
                      {pill(s.groupid)}
                      {rowButton(s.groupid)}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{s.brand || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className="font-semibold text-slate-900">{n(s.units)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{s.last_sale ? weekLabel(s.last_sale) : 'never'}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.idle_days ?? '—'}</td>
                    {cutCell(s.groupid)}
                  </tr>
                  {removeRow(s.groupid)}
                </Fragment>
              ))}
              {sold.length > 0 && (
                <tr className="border-b border-slate-100 bg-slate-50">
                  <td colSpan={7} className="px-4 py-1.5 text-xs font-medium text-slate-500">
                    In collection, no longer slow — sold in the last {data.days} days
                  </td>
                </tr>
              )}
              {sold.map((c) => (
                <Fragment key={c.handle}>
                  <tr className="border-b border-slate-100 text-slate-700 last:border-0">
                    {checkbox(c.groupid ?? c.handle)}
                    <td className="whitespace-nowrap px-4 py-2">
                      {c.groupid ? (
                        <Link href={`/pricing/style/${encodeURIComponent(c.groupid)}?from=${self}`} title={c.title ?? undefined}
                          className="font-medium text-slate-800 hover:text-brand-700 hover:underline">
                          {c.groupid}
                        </Link>
                      ) : (
                        <span title="Tagged in Shopify admin — not a style here" className="text-slate-500">{c.title || c.handle}</span>
                      )}
                      {c.price != null && <span className="ml-2 text-slate-500">£{c.price.toFixed(2)}</span>}
                      {c.groupid && rowButton(c.groupid)}
                    </td>
                    <td className="px-4 py-2 text-slate-500">—</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      <span className="font-semibold text-slate-900">{c.units == null ? '—' : n(c.units)}</span>
                    </td>
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2" />
                    {cutCell(c.groupid ?? c.handle)}
                  </tr>
                  {c.groupid && removeRow(c.groupid)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// REMOVE (one style) — take it out of the collection, optionally with a new price (blank = keep the current price). The tag comes off
// first; the price only goes if that worked, so a failed remove never leaves a style re-priced but still in the collection.
function RemoveForm({ groupid, price, onCancel, onDone }:
  { groupid: string; price: number | null; onCancel: () => void; onDone: (text: string) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typed = value.trim();
  const newPrice = typed === '' ? null : Number(typed);
  const bad = newPrice !== null && !(Number.isFinite(newPrice) && newPrice > 0);

  async function submit() {
    if (bad || busy) return;
    setBusy(true); setErr(null);
    const r = await setClearance([groupid], false);
    if (!(r.success && r.data && r.data.done.length === 1)) {
      setBusy(false);
      setErr(r.data?.failed[0]?.error || r.error || 'Remove failed');
      return;
    }
    if (newPrice !== null) {
      const rounded = Math.round(newPrice * 100) / 100;
      const p = await applyPrice(groupid, rounded, null, REMOVE_NOTE);
      setBusy(false);
      if (!p.success) { setErr(`Removed from the collection, but the price didn't save: ${p.error || 'error'}`); return; }
      onDone(`−1 removed · ${groupid} now £${rounded.toFixed(2)}`);
      return;
    }
    setBusy(false);
    onDone(`−1 removed · ${groupid}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="font-medium text-slate-700">Remove {groupid} from the collection</span>
      <label className="flex items-center gap-1.5 text-slate-500">
        New price £
        <input type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} autoFocus
          placeholder={price != null ? price.toFixed(2) : ''}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-right tabular-nums text-slate-900 focus:border-slate-500 focus:outline-none" />
      </label>
      <span className="text-xs text-slate-400">blank = keep {price != null ? `£${price.toFixed(2)}` : 'the price'}</span>
      <button type="button" onClick={submit} disabled={busy || bad}
        className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50">
        {busy ? 'Removing…' : newPrice !== null && !bad ? `Remove & set £${newPrice.toFixed(2)}` : 'Remove'}
      </button>
      <button type="button" onClick={onCancel} disabled={busy}
        className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline">
        Cancel
      </button>
      {err && <span className="text-red-700">{err}</span>}
    </div>
  );
}
