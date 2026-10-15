'use client';
/*
=======================================================================================================================================
Page: /analytics/revenue  (opened from the "12m revenue" box on Repricing's Status tab, 2026-10-14)
=======================================================================================================================================
Purpose: The breakdown behind the Winners screen's revenue figure. Owner, 2026-10-14: "I want to click on the card and go to the
         breakdown ... enough information to know how we are progressing." The rolling 12 months, every figure beside the year before.

         LAYOUT (owner, 2026-10-14: "think in the way of the WINNERS screen ... important headline figures at the top, then break it
         down downwards ... colour, cards and big numbers"):
           1. HEADLINES — four tiles that read as one sum: Revenue → what the channels leave → less the overheads they share = PROFIT,
              each with the year before under it. Revenue's growth is the ACCOUNTS' (see turnoverCheck) — ours overstates it while
              `sales` is short a year back.
           1b. KEY STATS (owner, 2026-10-15: "Revenue divided by wages. And anything else perhaps? Just stats") — a row of small
              ratios, each with the year before. See keyStats() for each one's basis.
           2. A CARD PER CHANNEL — big revenue + big Left, a "where every £ goes" bar, then the running list This year | Year before.
           3. OVERHEADS — wages, rent, general expenses (QuickFile P&L).
           4. The small print at the BOTTOM: dates, "What to provide", the notes (owner, 2026-10-15: "too much text at the top").
         COLOUR (owner, 2026-10-15: "cut down the number of different colours", then "not enough colour now"): ONE meaning — green is
         money kept (Profit, each channel's Left, the Left slice of the £ bar), red is a loss; everything else slate. Channels are told
         apart by their logos, not colour. No "plus"/"less" words — the minus says it. A negative year-before figure sits on its own
         line in red, so its minus can't read as a divider (owner).
         Channel cards run FULL WIDTH (figures + £ bar on the left, the list on the right), Overheads the same at the bottom.
         Spaced out on purpose (owner: "I don't want the values too close together on the screen").

         THE LISTS — every channel: VAT and cost of goods. Shopify also: delivery customers paid (free postage from 14 Oct 2026, kept so
         the year before shows what it gave up), platform fees, advertising, shipping. Amazon also: Amazon fees. CM3: VAT and cost only.
           - VAT       revenue / 6 (owner: kids' zero-rated sales are next to nothing, so no per-row tax test).
           - COST      server's `cogs`: TODAY's skusummary.cost x pairs, returns put back. Deleted styles: Shopify's from their stored
                       profit, Amazon's / CM3's at the channel's own cost ratio. Named in each card's footnote.
           - THE REST  advertising, shipping, Amazon fees and overheads from the QuickFile P&L by month; Shopify Payments and PayPal
                       from their own data, PayPal at its average past the last export. NO per-cell "est." marks and NO dates (owner:
                       "just show your average figure used rather than the date").

         Revenue is the Winners figure's own sum (soldprice x qty): VAT-inclusive and NET OF RETURNS. Every sale counts, and the
         Winners box shows this same live total (since 2026-10-15; it used to be the stamped sum, ~£19k lower).

Guarded by AppShell. Consumes GET /analytics-revenue.
=======================================================================================================================================
*/

import { Fragment, type ReactNode } from 'react';
import { BuildingStorefrontIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import { ChannelLogo } from '@/components/ChannelBadge';
import { useApiQuery } from '@/lib/useApiQuery';
import { getRevenue, RevenueChannel, RevenueData, RevenueOverhead, ShopifyExpenses } from '@/lib/api';

const gbp = (v: number) => `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`;
// £427,551 → £428k for the big tiles; under £10k stays exact.
const gbpK = (v: number) => (Math.abs(v) < 10000 ? gbp(v) : `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v) / 1000).toLocaleString('en-GB')}k`);

// 'YYYY-MM-DD' -> '14 Oct 26' without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(2, 4)}`;

const NAMES: Record<string, string> = { SHP: 'Shopify', AMZ: 'Amazon', CM3: 'CM3 shop' };
const nameOf = (code: string) => NAMES[code] ?? code;

// The "where every £ goes" bar: costs light to mid slate, what's left the darkest — no channel colours (owner, 2026-10-15).
const COST_COLOR: Record<string, string> = {
  VAT: '#e2e8f0', 'Cost of goods': '#cbd5e1', 'Platform fees': '#94a3b8', 'Amazon fees': '#94a3b8', Advertising: '#94a3b8',
  Shipping: '#94a3b8',
};
const LEFT_COLOR = '#059669';   // green: money kept, as on the Left box

const VAT_DIVISOR = 6;         // owner's rule: everything standard-rated

// Change on the year before, as a signed whole %. null when the year before had nothing to compare with.
const change = (now: number, prev: number) => (prev > 0 ? Math.round(((now - prev) / prev) * 100) : null);
const changeText = (c: number | null) => (c === null ? '–' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}%`);
const pctOf = (v: number, of: number) => (of > 0 ? `${Math.round((v / of) * 100)}%` : '–');

type Figures = Omit<RevenueChannel, 'channel'>;
type Row = { label: string; note?: string; now: string; prev: string; kind?: 'head' | 'plus' | 'less' | 'left' };
type Line = { label: string; now: number | null; prev: number | null };
type ChannelSum = { c: RevenueChannel; rows: Row[]; lines: Line[]; income: number; left: number; pLeft: number };

export default function RevenuePage() {
  const q = useApiQuery('analytics-revenue', () => getRevenue());
  const d = q.data;
  return (
    <AppShell backHref="/segments" backLabel="Winners">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {d && <Revenue data={d} />}
    </AppShell>
  );
}

function Revenue({ data }: { data: RevenueData }) {
  const { channels } = data;
  const sumOf = (k: keyof Figures) => channels.reduce((a, c) => a + c[k], 0);
  const all = Object.fromEntries(
    (['revenue', 'sold', 'returns', 'units', 'prev_revenue', 'prev_sold', 'prev_returns', 'prev_units', 'off_file', 'cogs', 'prev_cogs',
      'no_cost', 'prev_no_cost', 'cogs_filled', 'prev_cogs_filled'] as (keyof Figures)[]).map((k) => [k, sumOf(k)])
  ) as Figures;
  // Shopify first, then the rest largest first (the server's order).
  const lists: ChannelSum[] = [...channels]
    .sort((a, b) => (a.channel === 'SHP' ? -1 : b.channel === 'SHP' ? 1 : 0))
    .map((c) => ({ c, ...channelList(c, data) }));

  const leftSum = lists.reduce((a, l) => a + l.left, 0), pLeftSum = lists.reduce((a, l) => a + l.pLeft, 0);
  const oh = data.overheads.reduce((a, l) => a + (l.cur ?? 0), 0), pOh = data.overheads.reduce((a, l) => a + (l.prev ?? 0), 0);
  const profit = leftSum - oh, pProfit = pLeftSum - pOh;
  const t = data.accounts_turnover;
  // Growth by the ACCOUNTS where we have them: `sales` is short in the year before (recording started Aug 2024), so ours reads high.
  const growth = t && t.cur !== null && t.prev !== null ? change(t.cur, t.prev) : change(all.revenue, all.prev_revenue);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-900">Revenue &amp; profit</h1>

      {/* HEADLINES — one sum, left to right: revenue → channels leave → less overheads = profit. The year before under each. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Headline label="Revenue" value={gbpK(all.revenue)} sub={`${changeText(growth)} on the year before`} />
        <Headline label="Channels leave" value={gbpK(leftSum)} sub={<YearBefore v={pLeftSum} />} />
        <Headline label="Overheads" value={gbpK(oh)} sub={<YearBefore v={pOh} />} />
        <Headline label="Profit" value={gbpK(profit)} tone={profit >= 0 ? 'good' : 'bad'}
          sub={<>{pctOf(profit, all.revenue)} of revenue<br /><YearBefore v={pProfit} /></>} />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {keyStats(data, all, leftSum, pLeftSum, oh, pOh, profit, pProfit).map((k) => <Stat key={k.label} {...k} />)}
      </section>

      {/* A FULL-WIDTH CARD PER CHANNEL, then OVERHEADS (owner, 2026-10-15). */}
      <section className="space-y-5">
        {lists.map((l) => (
          <ChannelCard key={l.c.channel} l={l} share={all.revenue > 0 ? l.c.revenue / all.revenue : null} />
        ))}
        {data.overheads.length > 0 && <Overheads lines={data.overheads} />}
      </section>

      {/* THE SMALL PRINT (owner, 2026-10-15: "put them all at the bottom including what to provide"). */}
      <footer className="space-y-1.5 border-t border-slate-200 pt-4 text-xs text-slate-400">
        <p>
          This year {dateLabel(data.from)} – {dateLabel(data.to)}, year before {dateLabel(data.prev_from)} – {dateLabel(data.prev_to)}.
          Revenue is net of returns, inc. VAT.
        </p>
        {turnoverCheck(data, all) && <p>{turnoverCheck(data, all)}</p>}
        {lists.map((l) => {
          const f = channelFoot(l.c, data);
          return f && <p key={l.c.channel}>{nameOf(l.c.channel)}: {f}</p>;
        })}
        <Needs />
      </footer>
    </div>
  );
}

// WHAT THE OWNER PROVIDES, AND WHEN (owner, 2026-10-14: "an info that I expand on the screen ... Keep it brief"; generic wording, no
// names). Closed by default.
function Needs() {
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-slate-600">What to provide</summary>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">
        <li>Every month or two: QuickFile → Segmented P&amp;L by Months → CSV Download.</li>
        <li>Now and then: PayPal → All transactions export.</li>
        <li>Nothing else — Shopify fees and delivery update with &ldquo;Update now&rdquo;.</li>
      </ul>
    </details>
  );
}

function Headline({ label, value, sub, tone }: { label: string; value: string; sub: ReactNode; tone?: 'good' | 'bad' }) {
  const box = tone === 'good' ? 'border-emerald-200 bg-emerald-50' : tone === 'bad' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white';
  const num = tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900';
  return (
    <div className={`rounded-xl border p-5 shadow-sm ${box}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-4xl font-bold leading-none tabular-nums sm:text-5xl ${num}`}>{value}</div>
      <div className="mt-3 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

type KeyStat = { label: string; value: string; prev: string; note: string };

// KEY STATS. Turnover ex VAT (÷6, delivery in) where accountants compare against costs — the wage ratio and gross margin are always
// quoted ex VAT, as the accounts' General Sales. Break-even is on the HEADLINE's footing (revenue inc VAT, no delivery) so it reads
// straight against the £ in the Revenue tile (owner, 2026-10-15: "So do I compare that with current?").
// Break-even = overheads / (what the channels leave per £ of revenue): the revenue at which those pence just pay the overheads.
function keyStats(data: RevenueData, all: Figures, leftSum: number, pLeftSum: number, oh: number, pOh: number, profit: number,
  pProfit: number): KeyStat[] {
  const d = data.shopify_expenses?.delivery;
  const inc = all.revenue + (d?.cur ?? 0), pInc = all.prev_revenue + (d?.prev ?? 0);
  const exVat = inc * 5 / VAT_DIVISOR, pExVat = pInc * 5 / VAT_DIVISOR;
  const wages = data.overheads.find((o) => o.name === 'Wages');
  const shp = data.channels.find((c) => c.channel === 'SHP');
  const ads = data.shopify_expenses?.advertising;
  const pct = (a: number | null | undefined, b: number) => (a != null && b > 0 ? `${Math.round((a / b) * 100)}%` : '–');
  const pound = (v: number) => `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`;
  // Break-even: the revenue at which what the channels leave just pays the overheads, at today's rate of leaving.
  const be = leftSum > 0 ? oh / (leftSum / all.revenue) : null;
  const pBe = pLeftSum > 0 ? pOh / (pLeftSum / all.prev_revenue) : null;
  const s = data.stock;
  return [
    // Wages as a % of turnover (owner, 2026-10-15: "Should turnover wages be %?") — the usual UK form; lower is better.
    { label: 'Wages', value: pct(wages?.cur, exVat), prev: pct(wages?.prev, pExVat), note: 'of turnover, ex VAT' },
    { label: 'Gross margin', value: pct(exVat - all.cogs, exVat), prev: pct(pExVat - all.prev_cogs, pExVat), note: 'ex VAT, after cost of goods' },
    { label: 'Break-even revenue', value: be === null ? '–' : gbpK(be), prev: pBe === null ? '–' : gbpK(pBe),
      note: '' },
    { label: 'Advertising', value: pct(ads?.cur, shp?.revenue ?? 0), prev: pct(ads?.prev, shp?.prev_revenue ?? 0), note: 'of Shopify revenue' },
    { label: 'Returns', value: pct(-all.returns, all.sold), prev: pct(-all.prev_returns, all.prev_sold), note: 'of sales' },
    { label: 'Profit per pair', value: all.units > 0 ? pound(profit / all.units) : '–',
      prev: all.prev_units > 0 ? pound(pProfit / all.prev_units) : '–', note: `${all.units.toLocaleString('en-GB')} pairs` },
    // CASH IN STOCK and STOCK TURN (owner, 2026-10-15: the strategy is to rinse winners and clear non-movers at 90 days, so watch
    // how fast stock money comes back). Stock at cost, ex VAT. Turn = the year's cost of goods / its average stock; no stock history
    // before Oct 2025, so the turn has no year before.
    { label: 'Cash in stock', value: s ? gbpK(s.value) : '–', prev: s?.prev_value != null ? gbpK(s.prev_value) : '–',
      note: s ? `${s.units.toLocaleString('en-GB')} pairs, at cost` : '' },
    { label: 'Stock turn', value: s?.turn ? `${s.turn}×` : '–', prev: '',
      note: s?.turn ? `stock sells through every ${Math.round(365 / s.turn)} days` : '' },
  ];
}

function Stat({ label, value, prev, note }: KeyStat) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-slate-900">{value}</div>
      {prev && (
        <div className="mt-2 text-[11px] text-slate-500">
          Year before <span className={`font-semibold tabular-nums ${prev.startsWith('−') ? 'text-red-700' : 'text-slate-700'}`}>{prev}</span>
        </div>
      )}
      {note && <div className="mt-0.5 text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

// "Where every £ goes": the channel's income split into its costs (slate) and what's left (green).
function SpendBar({ l }: { l: ChannelSum }) {
  const segs = [
    ...l.lines.map((x) => ({ label: x.label, value: Math.max(0, x.now ?? 0), color: COST_COLOR[x.label] ?? '#94a3b8' })),
    { label: 'Left', value: Math.max(0, l.left), color: LEFT_COLOR },
  ].filter((s) => s.value > 0);
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return null;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
        {segs.map((s) => <span key={s.label} className="h-full" style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} <span className="tabular-nums">{pctOf(s.value, total)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ChannelMark({ code }: { code: string }) {
  if (code === 'SHP' || code === 'AMZ') return <ChannelLogo channel={code === 'SHP' ? 'shopify' : 'amazon'} size="md" />;
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ring-slate-200">
      <BuildingStorefrontIcon className="h-4 w-4 text-slate-600" aria-hidden="true" />
    </span>
  );
}

function ChannelCard({ l, share }: { l: ChannelSum; share: number | null }) {
  const c = change(l.c.revenue, l.c.prev_revenue);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-slate-900"><ChannelMark code={l.c.channel} />{nameOf(l.c.channel)}</h2>
        {share != null && <span className="text-xs text-slate-500">{Math.round(share * 100)}% of revenue</span>}
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_3fr] lg:gap-10">
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div className="px-1 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revenue</div>
              <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-slate-900">{gbpK(l.c.revenue)}</div>
              <div className="mt-1.5 text-xs text-slate-500">{changeText(c)} on the year before</div>
            </div>
            <Kept label="Left" v={l.left} sub={<>{pctOf(l.left, l.income)} of revenue<br /><YearBefore v={l.pLeft} /></>} />
          </div>
          <div className="mt-5"><SpendBar l={l} /></div>
        </div>
        <Table rows={l.rows} />
      </div>
    </section>
  );
}

// Money kept: green, or red when it's a loss — the page's one colour (see the header).
function Kept({ label, v, sub }: { label: string; v: number; sub: ReactNode }) {
  const bad = v < 0;
  return (
    <div className={`rounded-lg px-4 py-3 ring-1 ${bad ? 'bg-red-50 ring-red-200' : 'bg-emerald-50 ring-emerald-200'}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${bad ? 'text-red-700' : 'text-emerald-700'}`}>{label}</div>
      <div className={`mt-1 text-3xl font-bold leading-none tabular-nums ${bad ? 'text-red-700' : 'text-emerald-700'}`}>{gbpK(v)}</div>
      <div className="mt-1.5 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

// "Year before £12,130" — the figure for the same 12 months a year earlier, red when it was a loss.
function YearBefore({ v }: { v: number }) {
  return <>Year before <span className={`font-semibold tabular-nums ${v < 0 ? 'text-red-700' : 'text-slate-700'}`}>{gbpK(v)}</span></>;
}

// OVERHEADS (owner, 2026-10-14) — the whole business's costs from the QuickFile P&L: wages, rent, and the rest grouped as general
// expenses. Not a channel's; they come out of what the channels leave. Ex VAT, as the P&L has them.
function Overheads({ lines }: { lines: RevenueOverhead[] }) {
  const total = (k: 'cur' | 'prev') => lines.reduce((a, l) => a + (l[k] ?? 0), 0);
  const money = (v: number | null) => (v === null ? '–' : gbp(-v));
  const rows: Row[] = [
    ...lines.map((l): Row => ({ label: l.name, now: money(l.cur), prev: money(l.prev) })),
    { label: 'Total', now: gbp(-total('cur')), prev: gbp(-total('prev')), kind: 'left' },
  ];
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold text-slate-900">Overheads</h2>
      <div className="mt-4 grid gap-6 lg:grid-cols-[2fr_3fr] lg:gap-10">
        <div className="px-1 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Whole business</div>
          <div className="mt-1 text-3xl font-bold leading-none tabular-nums text-slate-900">{gbpK(total('cur'))}</div>
          <div className="mt-1.5 text-xs text-slate-500"><YearBefore v={total('prev')} /></div>
          <p className="mt-3 text-xs text-slate-400">Paid from what the channels leave.</p>
        </div>
        <Table rows={rows} />
      </div>
    </section>
  );
}

function Table({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-4 text-left font-medium" />
            <th className="px-3 py-2 text-right font-medium">This year</th>
            <th className="py-2 pl-3 text-right font-medium">Year before</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const sub = r.kind === 'less' || r.kind === 'plus';
            const cls = r.kind === 'left' ? 'border-t-2 border-slate-300 font-semibold text-slate-900'
              : r.kind === 'head' ? 'font-semibold text-slate-900' : 'text-slate-700';
            return (
              <Fragment key={r.label}>
                <tr className={cls}>
                  <td className={`py-2 pr-4 ${sub ? 'pl-3' : ''}`}>
                    {r.label}
                    {r.note && <span className="ml-2 text-xs font-normal text-slate-400">{r.note}</span>}
                  </td>
                  <td className="whitespace-pre px-3 py-2 text-right">{r.now}</td>
                  <td className="whitespace-pre py-2 pl-3 text-right text-slate-400">{r.prev}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// THE ACCOUNTS AS A CHECK (2026-10-14): the P&L's General Sales beside ours on the same footing (ex VAT, delivery in). This year
// agrees; the year before, `sales` is short (~£82k, mostly Nov 2024 – Feb 2025 — recording started Aug 2024).
function turnoverCheck(data: RevenueData, all: Figures): string | undefined {
  const t = data.accounts_turnover;
  if (!t || t.cur === null) return undefined;
  const d = data.shopify_expenses?.delivery;
  const ours = (all.revenue + (d?.cur ?? 0)) * 5 / VAT_DIVISOR, pOurs = (all.prev_revenue + (d?.prev ?? 0)) * 5 / VAT_DIVISOR;
  return `Accounts turnover ex VAT: ${gbp(t.cur)} this year, ${t.prev === null ? '–' : gbp(t.prev)} the year before. `
    + `Ours on the same basis: ${gbp(ours)}, ${gbp(pOurs)} — the year before is short because sales recording started Aug 2024.`;
}

function channelFoot(c: RevenueChannel, data: RevenueData): string | undefined {
  const parts: string[] = [];
  if (c.channel === 'SHP') {
    parts.push("Cost of goods is today's cost; for styles since deleted, the cost each sale was priced at.");
    if (c.no_cost !== 0 || c.prev_no_cost !== 0) {
      parts.push(`Refunds on deleted styles (${gbp(Math.abs(c.no_cost))} this year, ${gbp(Math.abs(c.prev_no_cost))} the year before) have no cost put back.`);
    }
    const r = data.shopify_expenses?.paypal.cur.rate;
    if (r != null) parts.push(`PayPal fees past the last export at ${(r * 100).toFixed(1)}% of revenue.`);
  }
  if (c.channel === 'AMZ') parts.push("Fees are the accounts' seller fees less Shopify's and PayPal's.");
  if (c.channel !== 'SHP' && (c.cogs_filled !== 0 || c.prev_cogs_filled !== 0)) {
    parts.push(`Deleted styles costed at the channel's average (${gbp(c.cogs_filled)} this year, ${gbp(c.prev_cogs_filled)} the year before).`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

// A channel's running list: revenue, what comes off it, what is left. A missing expense (null) counts as nothing and shows "–".
function channelList(f: RevenueChannel, data: RevenueData): Omit<ChannelSum, 'c'> {
  const x: ShopifyExpenses | null = f.channel === 'SHP' ? data.shopify_expenses : null;
  // Delivery customers paid sits under Revenue as income (it isn't in sales). VAT and the Left % are both on revenue + delivery.
  const del = x?.delivery?.cur ?? 0, pDel = x?.delivery?.prev ?? 0;
  const income = f.revenue + del, pIncome = f.prev_revenue + pDel;
  const money = (v: number | null) => (v === null ? '–' : gbp(-v));

  const lines: Line[] = [
    { label: 'VAT', now: income / VAT_DIVISOR, prev: pIncome / VAT_DIVISOR },
    { label: 'Cost of goods', now: f.cogs, prev: f.prev_cogs },
  ];
  if (x) {
    lines.push(
      // Combined lines (owner, 2026-10-14): Shopify Payments + PayPal = Platform fees; postage + packaging = Shipping.
      { label: 'Platform fees', now: sum([x.shopify_payments.cur.amount, x.paypal.cur.amount]),
        prev: sum([x.shopify_payments.prev.amount, x.paypal.prev.amount]) },
      { label: 'Advertising', now: x.advertising.cur, prev: x.advertising.prev },   // the P&L's, all Shopify's (owner, 2026-10-14)
      { label: 'Shipping', now: x.shipping.cur, prev: x.shipping.prev },
    );
  }
  if (f.channel === 'AMZ' && data.amazon_expenses) {
    lines.push(
      { label: 'Amazon fees', now: data.amazon_expenses.fees.cur, prev: data.amazon_expenses.fees.prev },
      // The P&L's 5100 Carriage — DPD to Amazon (owner, 2026-10-15).
      { label: 'Shipping', now: data.amazon_expenses.shipping?.cur ?? null, prev: data.amazon_expenses.shipping?.prev ?? null },
    );
  }
  const left = income - lines.reduce((a, l) => a + (l.now ?? 0), 0);
  const pLeft = pIncome - lines.reduce((a, l) => a + (l.prev ?? 0), 0);

  const rows: Row[] = [
    { label: 'Revenue', now: gbp(f.revenue), prev: gbp(f.prev_revenue), kind: 'head' },
    ...(x ? [{ label: 'Delivery charged', now: gbp(del), prev: gbp(pDel), kind: 'plus' as const }] : []),
    ...lines.map((l): Row => ({
      label: l.label, now: money(l.now), prev: money(l.prev), kind: 'less',
    })),
    { label: 'Left', note: 'of revenue', now: `${gbp(left)}  ·  ${pctOf(left, income)}`,
      prev: `${gbp(pLeft)}  ·  ${pctOf(pLeft, pIncome)}`, kind: 'left' },
  ];
  return { rows, lines, income, left, pLeft };
}

// Sum of the parts that are known; null only when none are (shown as '–').
function sum(vs: (number | null)[]): number | null {
  const known = vs.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, v) => a + v, 0) : null;
}
