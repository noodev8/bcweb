'use client';
/*
=======================================================================================================================================
Page: /analytics/revenue  (opened from the "12m revenue" box on Repricing's Status tab, 2026-10-14)
=======================================================================================================================================
Purpose: The breakdown behind the Winners screen's revenue figure. Owner, 2026-10-14: "I want to click on the card and go to the
         breakdown ... enough information to know how we are progressing." The rolling 12 months, every figure beside the year before.

         Layout (owner, 2026-10-14): the all-channel card on top with the PROFIT SUMMARY under the overall revenue (each channel's
         Left, less the overheads they share = Profit), then the Overheads card (wages, rent, general expenses — QuickFile P&L), then a
         card per channel. Each card is a table, This year | Year before, reading as a running list down to Left. Spaced out on
         purpose (owner: "I don't want the values too close together on the screen").
           - Every channel: VAT and cost of goods. Shopify also: delivery customers paid (free postage from 14 Oct 2026, kept so the
             year before shows what it gave up), platform fees, advertising (P&L), shipping (P&L). Amazon also: Amazon fees (P&L seller
             fees less Shopify's and PayPal's). CM3: VAT and cost only.
           - VAT       revenue / 6 (owner: kids' zero-rated sales are next to nothing, so no per-row tax test).
           - COST      server's `cogs`: TODAY's skusummary.cost x pairs, returns put back; a deleted style's sales take the cost
                       recovered from their stored profit. Only refunds on deleted styles stay uncosted, named under the list.
           - FEES, ADS, POSTAGE   from the server's `shopify_expenses`: real figures where held, an AVERAGE where they run out
                       (advertising, shipping, Amazon fees, overheads: the QuickFile P&L by month). NO per-cell "est." marks and NO dates (owner, 2026-10-14:
                       "to not make me feel on edge about giving you updates that don't do much for us, just show your average figure
                       used rather than the date. Every now and again I can give you data to recalculate the average"). The averages
                       in use are listed under the Shopify card instead.

         Revenue is the Winners figure's own sum (soldprice x qty): VAT-inclusive and NET OF RETURNS.

         THE TOTAL HERE IS HIGHER THAN THE WINNERS BOX, on purpose: this counts every sale, the box only styles still on file at the last
         "Update now". The footnote names the difference so the two numbers never look like a mistake (server header has the detail).

Guarded by AppShell. Consumes GET /analytics-revenue.
=======================================================================================================================================
*/

import { Fragment } from 'react';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getRevenue, RevenueChannel, RevenueData, RevenueOverhead, ShopifyExpenses } from '@/lib/api';

const gbp = (v: number) => `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`;

// 'YYYY-MM-DD' -> '14 Oct 26' without the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(2, 4)}`;

const NAMES: Record<string, string> = { SHP: 'Shopify', AMZ: 'Amazon', CM3: 'CM3 shop' };

const VAT_DIVISOR = 6;         // owner's rule: everything standard-rated

// Change on the year before, as a signed whole %. null when the year before had nothing to compare with.
const change = (now: number, prev: number) => (prev > 0 ? Math.round(((now - prev) / prev) * 100) : null);
const changeText = (c: number | null) => (c === null ? '–' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)}%`);
const changeCls = (c: number | null) => (c === null ? 'text-slate-400' : c > 0 ? 'text-emerald-700' : c < 0 ? 'text-red-700' : 'text-slate-600');
const pctOf = (v: number, of: number) => (of > 0 ? `${Math.round((v / of) * 100)}%` : '–');

type Figures = Omit<RevenueChannel, 'channel'>;
type Row = { label: string; note?: string; now: string; prev: string; kind?: 'head' | 'plus' | 'less' | 'left' };

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
  const sum = (k: keyof Figures) => channels.reduce((a, c) => a + c[k], 0);
  const all = Object.fromEntries(
    (['revenue', 'sold', 'returns', 'units', 'prev_revenue', 'prev_sold', 'prev_returns', 'prev_units', 'off_file', 'cogs', 'prev_cogs',
      'no_cost', 'prev_no_cost', 'cogs_filled', 'prev_cogs_filled'] as (keyof Figures)[]).map((k) => [k, sum(k)])
  ) as Figures;
  const share = (c: RevenueChannel) => (all.revenue > 0 ? c.revenue / all.revenue : null);
  // Shopify first, then the rest largest first (the server's order).
  const lists = [...channels]
    .sort((a, b) => (a.channel === 'SHP' ? -1 : b.channel === 'SHP' ? 1 : 0))
    .map((c) => ({ c, ...channelList(c, data) }));
  const shp = lists.find((l) => l.c.channel === 'SHP');
  const others = lists.filter((l) => l.c.channel !== 'SHP');

  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">Revenue</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        This year {dateLabel(data.from)} – {dateLabel(data.to)} · year before {dateLabel(data.prev_from)} – {dateLabel(data.prev_to)} ·
        net of returns, inc. VAT
      </p>
      <Needs />

      <div className="mt-5">
        <Card name="All channels" f={all} rows={profitRows(lists, data.overheads)} hero foot={turnoverCheck(data, all)} />
      </div>

      {data.overheads.length > 0 && <Overheads lines={data.overheads} />}

      {shp && (
        <div className="mt-5">
          <Card name="Shopify" f={shp.c} share={share(shp.c)} rows={shp.rows}
            foot={`Cost of goods is today's cost; for styles since deleted, the cost each sale was priced at.${
              shp.c.no_cost !== 0 || shp.c.prev_no_cost !== 0
                ? ` Refunds on deleted styles (${gbp(Math.abs(shp.c.no_cost))} this year, ${gbp(Math.abs(shp.c.prev_no_cost))} the year before) have no cost put back.`
                : ''}`} />
          {data.shopify_expenses && <Upkeep x={data.shopify_expenses} />}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {others.map(({ c, rows }) => (
          <Card key={c.channel} name={NAMES[c.channel] ?? c.channel} f={c} share={share(c)} rows={rows}
            foot={[
              c.channel === 'AMZ' ? "Fees are the accounts' seller fees less Shopify's and PayPal's." : '',
              c.cogs_filled !== 0 || c.prev_cogs_filled !== 0
                ? `Deleted styles costed at the channel's average (${gbp(c.cogs_filled)} this year, ${gbp(c.prev_cogs_filled)} the year before).`
                : '',
            ].filter(Boolean).join(' ') || undefined} />
        ))}
      </div>

      {all.off_file > 0 && (
        <p className="mt-4 text-xs text-slate-400">
          The Winners screen shows {gbp(all.revenue - all.off_file)}: it leaves out {gbp(all.off_file)} this year from styles no longer on
          file and shop items with no style.
        </p>
      )}
    </>
  );
}

// WHAT THE OWNER SENDS, AND WHEN (owner, 2026-10-14: "an info that I expand on the screen to remind me what to get you. Keep it
// brief"). Closed by default.
function Needs() {
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none text-slate-600">What to provide</summary>
      <ul className="mt-1.5 list-disc space-y-1 pl-5">
        <li>Every month or two: QuickFile → Segmented P&amp;L by Months → CSV Download.</li>
        <li>Now and then: PayPal → All transactions export.</li>
        <li>Nothing else — Shopify fees and delivery update with &ldquo;Update now&rdquo;.</li>
      </ul>
    </details>
  );
}

// THE ACCOUNTS AS A CHECK (2026-10-14): the P&L's General Sales beside ours on the same footing (ex VAT, delivery in). This year
// agrees; the year before, `sales` is short (~£82k, mostly Nov 2024 – Feb 2025), so its revenue and growth read low/high.
function turnoverCheck(data: RevenueData, all: Figures): string | undefined {
  const t = data.accounts_turnover;
  if (!t || t.cur === null) return undefined;
  const d = data.shopify_expenses?.delivery;
  const ours = (all.revenue + (d?.cur ?? 0)) * 5 / VAT_DIVISOR, pOurs = (all.prev_revenue + (d?.prev ?? 0)) * 5 / VAT_DIVISOR;
  return `Accounts turnover ex VAT: ${gbp(t.cur)} this year, ${t.prev === null ? '–' : gbp(t.prev)} the year before. `
    + `Ours on the same basis: ${gbp(ours)}, ${gbp(pOurs)}.`;
}

type Line = { label: string; now: number | null; prev: number | null };

// A channel's running list: revenue, what comes off it, what is left. A missing expense (null) counts as nothing and shows "–".
// Every channel: VAT and cost of goods. Shopify adds delivery income, platform fees, advertising, shipping; Amazon its fees.
function channelList(f: RevenueChannel, data: RevenueData): { rows: Row[]; left: number; pLeft: number } {
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
      // Combined lines (owner, 2026-10-14): Shopify Payments + PayPal = Platform fees; Royal Mail + packing bags = Shipping.
      { label: 'Platform fees', now: sum([x.shopify_payments.cur.amount, x.paypal.cur.amount]),
        prev: sum([x.shopify_payments.prev.amount, x.paypal.prev.amount]) },
      { label: 'Advertising', now: x.advertising.cur, prev: x.advertising.prev },   // the P&L's, all Shopify's (owner, 2026-10-14)
      { label: 'Shipping', now: x.shipping.cur, prev: x.shipping.prev },
    );
  }
  if (f.channel === 'AMZ' && data.amazon_expenses) {
    lines.push({ label: 'Amazon fees', now: data.amazon_expenses.fees.cur, prev: data.amazon_expenses.fees.prev });
  }
  const left = income - lines.reduce((a, l) => a + (l.now ?? 0), 0);
  const pLeft = pIncome - lines.reduce((a, l) => a + (l.prev ?? 0), 0);

  const rows: Row[] = [
    { label: 'Revenue', now: gbp(f.revenue), prev: gbp(f.prev_revenue), kind: 'head' },
    ...(x ? [{ label: 'Delivery charged', note: 'free from 14 Oct 26', now: gbp(del), prev: gbp(pDel), kind: 'plus' as const }] : []),
    ...lines.map((l): Row => ({
      label: l.label, note: l.label === 'VAT' ? '÷ 6' : undefined, now: money(l.now), prev: money(l.prev), kind: 'less',
    })),
    { label: 'Left', note: 'of revenue', now: `${gbp(left)}  ·  ${pctOf(left, income)}`,
      prev: `${gbp(pLeft)}  ·  ${pctOf(pLeft, pIncome)}`, kind: 'left' },
  ];
  return { rows, left, pLeft };
}

// THE SUMMARY under the overall revenue (owner, 2026-10-14: "a summary of our profit under the overall revenue"): what each channel
// leaves, less the overheads they share = profit (before corporation tax). The % is of revenue.
function profitRows(lists: { c: RevenueChannel; left: number; pLeft: number }[], overheads: RevenueOverhead[]): Row[] {
  const oh = overheads.reduce((a, l) => a + (l.cur ?? 0), 0), pOh = overheads.reduce((a, l) => a + (l.prev ?? 0), 0);
  const profit = lists.reduce((a, l) => a + l.left, 0) - oh, pProfit = lists.reduce((a, l) => a + l.pLeft, 0) - pOh;
  const rev = lists.reduce((a, l) => a + l.c.revenue, 0), pRev = lists.reduce((a, l) => a + l.c.prev_revenue, 0);
  return [
    ...lists.map(({ c, left, pLeft }): Row => ({
      label: `${NAMES[c.channel] ?? c.channel} left`, now: gbp(left), prev: gbp(pLeft),
    })),
    ...(overheads.length ? [{ label: 'Overheads', now: gbp(-oh), prev: gbp(-pOh), kind: 'less' as const }] : []),
    { label: 'Profit', note: 'of revenue', now: `${gbp(profit)}  ·  ${pctOf(profit, rev)}`,
      prev: `${gbp(pProfit)}  ·  ${pctOf(pProfit, pRev)}`, kind: 'left' },
  ];
}

// OVERHEADS (owner, 2026-10-14) — the whole business's costs from the QuickFile P&L: wages, rent, and the rest grouped as general
// expenses. Not a channel's, so their own card; they come out of what the channels leave. Ex VAT, as the P&L has them.
function Overheads({ lines }: { lines: RevenueOverhead[] }) {
  const total = (k: 'cur' | 'prev') => lines.reduce((a, l) => a + (l[k] ?? 0), 0);
  const money = (v: number | null) => (v === null ? '–' : gbp(-v));
  return (
    <section className="mt-5 rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-800">Overheads</h2>
      <p className="mt-0.5 text-xs text-slate-500">The whole business, from the accounts. Paid from what the channels leave.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4 text-left font-medium" />
              <th className="px-4 py-2 text-right font-medium">This year</th>
              <th className="py-2 pl-4 text-right font-medium">Year before</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {lines.map((l) => (
              <tr key={l.name} className="border-b border-slate-100 text-slate-700">
                <td className="py-2.5 pr-4">{l.name}</td>
                <td className="px-4 py-2.5 text-right">{money(l.cur)}</td>
                <td className="py-2.5 pl-4 text-right">{money(l.prev)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold text-slate-900">
              <td className="py-2.5 pr-4">Total</td>
              <td className="px-4 py-2.5 text-right">{gbp(-total('cur'))}</td>
              <td className="py-2.5 pl-4 text-right">{gbp(-total('prev'))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Sum of the parts that are known; null only when none are (shown as '–').
function sum(vs: (number | null)[]): number | null {
  const known = vs.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, v) => a + v, 0) : null;
}

// THE AVERAGES IN USE (owner, 2026-10-14: "just show your average figure used rather than the date. Every now and again I can give
// you data to recalculate the average"). Where real figures run out, a line falls back to its average; listing the averages here
// keeps that honest without dates that read as a deadline. This year's averages only — the ones new figures would change.
// Shopify Payments isn't listed: "Update now" on Repricing keeps it real. Nor are the P&L lines: monthly from the accounts.
function Upkeep({ x }: { x: ShopifyExpenses }) {
  const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1)}% of revenue`);
  const items = [
    { what: 'PayPal fees', avg: pct(x.paypal.cur.rate) },
  ];
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 px-5 py-3 text-xs text-slate-500">
      <span className="font-medium text-slate-600">Averages used</span> where we don&rsquo;t hold real figures. New figures now and
      again recalculate them.
      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
        {items.map((i) => (
          <span key={i.what}>{i.what} <span className="tabular-nums text-slate-700">{i.avg}</span></span>
        ))}
      </div>
    </div>
  );
}

function Card({ name, f, share, rows, hero, foot }: {
  name: string; f: Figures; share?: number | null; rows: Row[]; hero?: boolean; foot?: string;
}) {
  const c = change(f.revenue, f.prev_revenue);
  const hasList = rows.some((r) => r.kind === 'left');
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-6 py-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-800">{name}</h2>
        {share != null && <span className="text-xs text-slate-500">{Math.round(share * 100)}% of revenue</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`${hero ? 'text-5xl' : 'text-3xl'} font-semibold leading-none tabular-nums text-slate-900`}>{gbp(f.revenue)}</span>
        <span className="text-sm text-slate-500">
          <span className={`font-semibold ${changeCls(c)}`}>{changeText(c)}</span> on the year before
        </span>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className={`w-full text-sm ${hasList ? 'max-w-2xl' : 'max-w-xl'}`}>
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-4 text-left font-medium" />
              <th className="px-4 py-2 text-right font-medium">This year</th>
              <th className="py-2 pl-4 text-right font-medium">Year before</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => {
              const cls =
                r.kind === 'left' ? 'border-t-2 border-slate-300 font-semibold text-slate-900'
                : r.kind === 'head' ? 'font-semibold text-slate-900'
                : 'text-slate-700';
              return (
                <Fragment key={r.label}>
                <tr className={cls}>
                  <td className={`py-2.5 pr-4 ${r.kind === 'less' || r.kind === 'plus' ? 'pl-4' : ''}`}>
                    {(r.kind === 'less' || r.kind === 'plus') && <span className="mr-1 text-slate-400">{r.kind}</span>}
                    {r.label}
                    {r.note && <span className="ml-2 text-xs font-normal text-slate-400">{r.note}</span>}
                  </td>
                  <td className="whitespace-pre px-4 py-2.5 text-right">{r.now}</td>
                  <td className={`whitespace-pre py-2.5 pl-4 text-right ${r.kind === 'left' ? 'text-slate-600' : 'text-slate-500'}`}>{r.prev}</td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {foot && <p className="mt-4 max-w-2xl text-xs text-slate-400">{foot}</p>}
    </section>
  );
}
