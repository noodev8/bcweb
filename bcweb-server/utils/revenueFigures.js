/*
=======================================================================================================================================
Module: utils/revenueFigures.js
=======================================================================================================================================
Purpose: The expense and cost-of-goods reads behind Reports -> Revenue & profit, for ANY set of date windows. Moved here from
         routes/analytics-revenue.js on 2026-10-26 when the page gained its month-by-month table (owner: "show the monthly on the
         revenue page as a small table ... or a drill down from the profit card"), so the 12-month figures and each month's are the
         SAME reads, not two copies that can drift.

         COMPLETE P&L MONTHS ONLY (owner, 2026-10-26: "remove the current month where we dont have enough data. Always from last
         month"). Every window ENDS at END_SQL: the last day of last month, or of the last month the QuickFile P&L covers if that is
         earlier (early in a month, before last month's P&L is imported). Until then the page ran to TODAY and filled the days no
         P&L month covered at the year's average daily rate — a quiet October costed at a summer average read £4.4k lower than the
         same 12 months by calendar month, and the owner couldn't square the two. Now nothing is estimated from the P&L.

         A WINDOWS query is SQL returning rows (w, f, t): a window's key and its first and last day, inclusive.
           WINDOWS_SQL  'cur' = the 12 whole months to END, 'prev' = the 12 before (routes/analytics-revenue.js)
           MONTHS_SQL   the same 12 months one by one, keyed 'YYYY-MM' (routes/analytics-revenue-months.js) — so the month table adds
                        up to the 'cur' figures exactly.
         Every read returns its figures keyed by the window key, so { cur, prev } for the first and { '2025-10': …, … } for the second.
         Window SQL is only ever one of the constants here — never request data.

         See routes/analytics-revenue.js's header for what each line is and where it comes from.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const { costFromProfitSql } = require('./shopifyProfit');

// The last day of the windows: last month's end, or the P&L's last day if earlier. The overheads ('ALL') stand for the whole P&L —
// pl-import.js writes every line of a month together. LEAST ignores the NULL of an empty table, so that falls back to last month.
const END_SQL = `
  (SELECT LEAST((date_trunc('month', CURRENT_DATE::timestamp) - INTERVAL '1 day')::date, MAX(period_to))
     FROM expense_figure WHERE channel = 'ALL')`;
// The first of END's month — the 12th of the 12 months.
const LAST_MONTH_SQL = `date_trunc('month', ${END_SQL}::timestamp)`;

const WINDOWS_SQL = `
  SELECT 'cur' AS w, (${LAST_MONTH_SQL} - INTERVAL '11 months')::date AS f, ${END_SQL} AS t
  UNION ALL
  SELECT 'prev', (${LAST_MONTH_SQL} - INTERVAL '23 months')::date, (${LAST_MONTH_SQL} - INTERVAL '11 months' - INTERVAL '1 day')::date`;

// The last `n` months to END, one window each. 12 = the page's months; 13 adds the month a year before the latest (the month table's
// comparison row — owner, 2026-10-26: "compare Sep 26 with Sep 25 ... not included in total though").
const monthsSql = (n) => `
  SELECT to_char(m, 'YYYY-MM') AS w, m::date AS f, (m + INTERVAL '1 month' - INTERVAL '1 day')::date AS t
  FROM generate_series(${LAST_MONTH_SQL} - INTERVAL '${Number(n) - 1} months', ${LAST_MONTH_SQL}, INTERVAL '1 month') m`;
const MONTHS_SQL = monthsSql(12);

const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

// Cost of goods for one sales row (alias s, skusummary ss), at TODAY's cost — sales rows carry none: a return's negative qty puts its
// pair back. A Shopify SALE of a style deleted since has no skusummary row, so its cost is recovered from its stored profit.
const COGS_SQL = `
  CASE WHEN ss.groupid IS NOT NULL THEN ${safeNumeric('ss.cost')} * s.qty
       WHEN s.channel = 'SHP' AND s.qty > 0 THEN ${costFromProfitSql('s.soldprice', 's.profit')} * s.qty
  END`;

// AMAZON / CM3 UNCOSTED REVENUE (2026-10-14): a deleted style's sales have no cost, and Amazon's stored profit can't give it back
// (its formula carries the FBA fee, which moves — inverting it matched today's cost on only 67% of live rows). So that revenue is
// costed at the channel's OWN cost ratio on the revenue that has a cost. Returns the part to add. Shopify keeps its recovery from
// stored profit (COGS_SQL); its only leftover is refunds on deleted styles, left as they are.
const fillCogs = (channel, cogs, rev, noCost) => (channel === 'SHP' || rev - noCost === 0 ? 0 : noCost * (cogs / (rev - noCost)));

// SHOPIFY EXPENSES. Four reads, each keyed by window.
async function shopifyExpenses(db = { query }, win = WINDOWS_SQL) {   // db: a transaction client in the rollback test, else the pool
  const [fees, delivery, advertising, shipping] = await Promise.all([
    // FEES: real where fee_daily covers the day; outside a source's covered range, its own real rate (fees / Shopify revenue over
    // the covered range) x that day's Shopify revenue. rate NULL = nothing stored for the source yet, so no estimate either.
    db.query(`
      WITH win AS (${win}),
      src AS (SELECT unnest(ARRAY['SHOPIFY_PAYMENTS', 'PAYPAL']) AS source),
      shp AS (SELECT solddate AS day, SUM(soldprice * qty) AS rev FROM sales WHERE channel = 'SHP' GROUP BY solddate),
      cov AS (SELECT source, MIN(day) AS f, MAX(day) AS t, SUM(fees) AS fees FROM fee_daily GROUP BY source),
      rate AS (SELECT c.source, c.f, c.t, c.fees / NULLIF((SELECT SUM(rev) FROM shp WHERE shp.day BETWEEN c.f AND c.t), 0) AS rate
               FROM cov c)
      SELECT s.source, w.w,
             COALESCE((SELECT SUM(fd.fees) FROM fee_daily fd
                       WHERE fd.source = s.source AND fd.day BETWEEN w.f AND w.t), 0)::float8 AS real,
             (SELECT SUM(shp.rev) FROM shp
              WHERE shp.day BETWEEN w.f AND w.t AND (r.f IS NULL OR shp.day NOT BETWEEN r.f AND r.t))::float8 AS uncovered_rev,
             r.rate::float8 AS rate,
             GREATEST(w.f, r.f)::text AS real_from, LEAST(w.t, r.t)::text AS real_to
      FROM src s CROSS JOIN win w LEFT JOIN rate r ON r.source = s.source
    `),
    // DELIVERY CHARGED to the customer (shopify_delivery, per order, net of delivery refunds, inc. VAT), by the order's day. INCOME,
    // not an expense — it sits under Revenue on the page. Free postage from 2026-10-14, so it runs to £0 from there on purpose.
    db.query(`
      WITH win AS (${win})
      SELECT w.w, COALESCE(SUM(d.charged - d.refunded), 0)::float8 AS amount
      FROM win w LEFT JOIN shopify_delivery d ON d.order_day BETWEEN w.f AND w.t
      GROUP BY w.w
    `),
    // ADVERTISING (owner, 2026-10-14: "take advertising from the P&L and charge it to shopify. It will be the most accurate") — the P&L's
    // 6201, all of it Shopify's (no Amazon ads). Replaced the google_product_daily sum, which missed ~£17k of other channels the
    // year before. SHIPPING — the P&L's 7501 Postage and Carriage + 5003 Packaging.
    plLines(db, 'SHP', 'Advertising', win),
    plLines(db, 'SHP', 'Shipping', win),
  ]);

  const keys = [...new Set(fees.rows.map((f) => f.w))];
  const feeLine = (source) => {
    const at = (w) => {
      const x = fees.rows.find((f) => f.source === source && f.w === w);
      const est = x.rate === null ? null : (x.uncovered_rev || 0) * x.rate;
      const real_days = x.real_from && x.real_to && x.real_from <= x.real_to ? { from: x.real_from, to: x.real_to } : null;
      return { amount: r2(x.real + (est || 0)), real: r2(x.real), est: r2(est), rate: x.rate, real_days };
    };
    return Object.fromEntries(keys.map((w) => [w, at(w)]));
  };
  return {
    shopify_payments: feeLine('SHOPIFY_PAYMENTS'),
    paypal: feeLine('PAYPAL'),
    advertising: advertising[0] || { name: 'Advertising', cur: null, prev: null },
    shipping: shipping[0] || { name: 'Shipping', cur: null, prev: null },
    delivery: Object.fromEntries(delivery.rows.map((d) => [d.w, r2(d.amount)])),
  };
}

// OVERHEADS (owner, 2026-10-14: wages, rent "and then group others into general expenses") — the whole business's costs, not a
// channel's, so expense_figure channel 'ALL'.
function overheadLines(db = { query }, win = WINDOWS_SQL) {
  return plLines(db, 'ALL', null, win);
}

// A P&L line per window (see P&L LINES in routes/analytics-revenue.js): the monthly rows inside the window, part months pro rata by
// days, then scaled up for any days no month covers (amount x window days / covered days). Months never overlap — pl-import.js
// replaces a month rather than adding a second row. name null = every name on the channel. null where nothing covers the window at all.
async function plLines(db, channel, only, win = WINDOWS_SQL) {
  const r = await db.query(`
    WITH win AS (${win}),
    fig AS (SELECT name, amount, period_from AS f, period_to AS t FROM expense_figure
            WHERE channel = $1 AND ($2::text IS NULL OR name = $2)),
    o AS (SELECT fig.name, w.w, (w.t - w.f + 1) AS days, fig.amount, (fig.t - fig.f + 1) AS len,
                 GREATEST(0, LEAST(fig.t, w.t) - GREATEST(fig.f, w.f) + 1) AS overlap
          FROM fig CROSS JOIN win w)
    SELECT name, w, SUM(amount * overlap / len)::float8 AS amount, SUM(overlap)::int AS covered, MAX(days)::int AS days
    FROM o GROUP BY name, w
  `, [channel, only]);
  const keys = [...new Set(r.rows.map((x) => x.w))];
  const at = (name, w) => {
    const x = r.rows.find((y) => y.name === name && y.w === w);
    return x && x.covered > 0 ? r2(x.amount * x.days / x.covered) : null;
  };
  return [...new Set(r.rows.map((x) => x.name))]
    .map((name) => ({ name, ...Object.fromEntries(keys.map((w) => [w, at(name, w)])) }))
    .sort((a, b) => (b.cur || 0) - (a.cur || 0));
}

// AMAZON FEES (owner, 2026-10-14) = the QuickFile P&L's 6003 Seller Fees, which holds EVERY channel's fees (Month End posts
// Amazon's, Shopify's and PayPal's there — utils/financeQuickFile.js), less the Shopify Payments and PayPal fees this screen
// already holds. What remains is Amazon's (referral, FBA, storage, subscription; SumUp's few pounds too). Ex VAT, as the P&L.
// SHIPPING is the P&L's 5100 Carriage — DPD to Amazon (owner, 2026-10-15). `keys` = the window keys to return.
function amazonExpenses(sellerFees, amzShipping, shp, keys = ['cur', 'prev']) {
  const sf = sellerFees[0] || { cur: null, prev: null };
  const ship = amzShipping[0] || {};
  const fee = (w) => (sf[w] == null ? null
    : r2(sf[w] - (shp.shopify_payments[w]?.amount || 0) - (shp.paypal[w]?.amount || 0)));
  return {
    fees: Object.fromEntries(keys.map((w) => [w, fee(w)])),
    seller_fees: sf,
    shipping: Object.fromEntries(keys.map((w) => [w, ship[w] ?? null])),
  };
}

module.exports = {
  WINDOWS_SQL, MONTHS_SQL, monthsSql, COGS_SQL, fillCogs, shopifyExpenses, overheadLines, plLines, amazonExpenses,
};
