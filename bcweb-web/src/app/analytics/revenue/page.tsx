'use client';
/*
=======================================================================================================================================
Page: /analytics/revenue  (opened from the "12m revenue" box on Repricing's Status tab, 2026-10-14)
=======================================================================================================================================
Purpose: The breakdown behind the Winners screen's revenue figure. Owner, 2026-10-14: "I want to click on the card and go to the
         breakdown ... enough information to know how we are progressing." The rolling 12 months, every figure beside the year before.

         Layout (owner, 2026-10-14: "a card for each channel. I will then start building the expenses for each and see what we have
         left"): an all-channel card on top, then one card per channel. Each card is a table, This year | Year before.

         EXPENSES, ONE CHANNEL AT A TIME — Shopify first (owner, 2026-10-14). The Shopify card is full width and reads as a running list:
         Revenue, plus delivery customers paid (not in sales; free postage from 14 Oct 2026, so it runs down to £0 — kept so the
         year before shows what free postage gave up), less VAT, cost of goods, fees, Google Ads, postage, packing = Left. Kept high level on purpose. Amazon and CM3 show revenue only
         until their turn. Spaced out on purpose (owner: "I don't want the values too close together on the screen").
           - VAT       revenue / 6 (owner: kids' zero-rated sales are next to nothing, so no per-row tax test).
           - COST      server's `cogs`: TODAY's skusummary.cost x pairs, returns put back; a deleted style's sales take the cost
                       recovered from their stored profit. Only refunds on deleted styles stay uncosted, named under the list.
           - FEES, ADS, POSTAGE   from the server's `shopify_expenses`: real figures where held, an AVERAGE where they run out
                       (Royal Mail and bags are each year's average per pair). NO per-cell "est." marks and NO dates (owner, 2026-10-14:
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
import { getRevenue, RevenueChannel, RevenueData, ShopifyExpenses } from '@/lib/api';

const gbp = (v: number) => `${v < 0 ? '−' : ''}£${Math.round(Math.abs(v)).toLocaleString('en-GB')}`;
const n = (v: number) => v.toLocaleString('en-GB');

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
type Row = { label: string; note?: string; now: string; prev: string; kind?: 'head' | 'plus' | 'less' | 'left' | 'detail' };

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
      'no_cost', 'prev_no_cost'] as (keyof Figures)[]).map((k) => [k, sum(k)])
  ) as Figures;
  const shp = channels.find((c) => c.channel === 'SHP');
  const others = channels.filter((c) => c.channel !== 'SHP');
  const share = (c: RevenueChannel) => (all.revenue > 0 ? c.revenue / all.revenue : null);

  return (
    <>
      <h1 className="text-lg font-semibold text-slate-900">Revenue</h1>
      <p className="mt-0.5 text-sm text-slate-500">
        This year {dateLabel(data.from)} – {dateLabel(data.to)} · year before {dateLabel(data.prev_from)} – {dateLabel(data.prev_to)} ·
        net of returns, inc. VAT
      </p>

      <div className="mt-5">
        <Card name="All channels" f={all} rows={detailRows(all)} hero />
      </div>

      {shp && (
        <div className="mt-5">
          <Card name="Shopify" f={shp} share={share(shp)} rows={[...shopifyRows(shp, data), ...detailRows(shp)]}
            foot={`Cost of goods is today's cost; for styles since deleted, the cost each sale was priced at.${
              shp.no_cost !== 0 || shp.prev_no_cost !== 0
                ? ` Refunds on deleted styles (${gbp(Math.abs(shp.no_cost))} this year, ${gbp(Math.abs(shp.prev_no_cost))} the year before) have no cost put back.`
                : ''}`} />
          {data.shopify_expenses && <Upkeep x={data.shopify_expenses} />}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {others.map((c) => (
          <Card key={c.channel} name={NAMES[c.channel] ?? c.channel} f={c} share={share(c)} rows={detailRows(c)} />
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

// Shopify's running list: revenue, what comes off it, what is left. A missing expense (null) counts as nothing and shows "–".
function shopifyRows(f: Figures, data: RevenueData): Row[] {
  const x: ShopifyExpenses | null = data.shopify_expenses;
  // Delivery customers paid sits under Revenue as income (it isn't in sales). VAT and the Left % are both on revenue + delivery.
  const del = x?.delivery?.cur ?? 0, pDel = x?.delivery?.prev ?? 0;
  const income = f.revenue + del, pIncome = f.prev_revenue + pDel;
  const vat = income / VAT_DIVISOR, pVat = pIncome / VAT_DIVISOR;
  const money = (v: number | null) => (v === null ? '–' : gbp(-v));

  const lines: { label: string; now: number | null; prev: number | null }[] = [
    { label: 'VAT', now: vat, prev: pVat },
    { label: 'Cost of goods', now: f.cogs, prev: f.prev_cogs },
  ];
  if (x) {
    lines.push(
      { label: 'Shopify Payments fees', now: x.shopify_payments.cur.amount, prev: x.shopify_payments.prev.amount },
      { label: 'PayPal fees', now: x.paypal.cur.amount, prev: x.paypal.prev.amount },
      { label: 'Google Ads', now: x.google_ads.cur.amount, prev: x.google_ads.prev.amount },
      ...x.figures.map((fig) => ({ label: fig.name, now: fig.cur, prev: fig.prev })),
    );
  }
  const left = income - lines.reduce((a, l) => a + (l.now ?? 0), 0);
  const pLeft = pIncome - lines.reduce((a, l) => a + (l.prev ?? 0), 0);

  return [
    { label: 'Revenue', now: gbp(f.revenue), prev: gbp(f.prev_revenue), kind: 'head' },
    ...(x ? [{ label: 'Delivery charged', note: 'free from 14 Oct 26', now: gbp(del), prev: gbp(pDel), kind: 'plus' as const }] : []),
    ...lines.map((l): Row => ({
      label: l.label, note: l.label === 'VAT' ? '÷ 6' : undefined, now: money(l.now), prev: money(l.prev), kind: 'less',
    })),
    { label: 'Left', note: 'of revenue', now: `${gbp(left)}  ·  ${pctOf(left, income)}`,
      prev: `${gbp(pLeft)}  ·  ${pctOf(pLeft, pIncome)}`, kind: 'left' },
  ];
}

// THE AVERAGES IN USE (owner, 2026-10-14: "just show your average figure used rather than the date. Every now and again I can give
// you data to recalculate the average"). Where real figures run out, a line falls back to its average; listing the averages here
// keeps that honest without dates that read as a deadline. This year's averages only — the ones new figures would change.
// Shopify Payments isn't listed: "Update now" on Repricing keeps it real.
function Upkeep({ x }: { x: ShopifyExpenses }) {
  const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1)}% of revenue`);
  const items = [
    ...x.figures.map((f) => ({ what: f.name, avg: f.per_pair === null ? '–' : `£${f.per_pair.toFixed(2)} a pair` })),
    { what: 'PayPal fees', avg: pct(x.paypal.cur.rate) },
    { what: 'Google Ads', avg: pct(x.google_ads.cur.rate) },
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

// The supporting lines every card carries, under revenue (or under Left on Shopify).
function detailRows(f: Figures): Row[] {
  return [
    { label: 'Sold', now: gbp(f.sold), prev: gbp(f.prev_sold), kind: 'detail' },
    { label: 'Returns', note: 'of sold', now: `${gbp(f.returns)}  ·  ${pctOf(-f.returns, f.sold)}`,
      prev: `${gbp(f.prev_returns)}  ·  ${pctOf(-f.prev_returns, f.prev_sold)}`, kind: 'detail' },
    { label: 'Pairs', now: n(f.units), prev: n(f.prev_units), kind: 'detail' },
  ];
}

function Card({ name, f, share, rows, hero, foot }: {
  name: string; f: Figures; share?: number | null; rows: Row[]; hero?: boolean; foot?: string;
}) {
  const c = change(f.revenue, f.prev_revenue);
  const firstDetail = rows.findIndex((r) => r.kind === 'detail');
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
            {rows.map((r, i) => {
              // A gap between the expense list and the supporting detail, so the two blocks don't read as one.
              const gapAbove = hasList && i === firstDetail;
              const cls =
                r.kind === 'left' ? 'border-t-2 border-slate-300 font-semibold text-slate-900'
                : r.kind === 'head' ? 'font-semibold text-slate-900'
                : r.kind === 'less' || r.kind === 'plus' ? 'text-slate-700'
                : 'text-slate-600';
              return (
                <Fragment key={r.label}>
                {gapAbove && <tr aria-hidden="true"><td colSpan={3} className="h-6" /></tr>}
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
