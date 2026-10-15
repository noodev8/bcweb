/*
=======================================================================================================================================
API Route: analytics_revenue
=======================================================================================================================================
Method: GET
Purpose: Reports -> Revenue, opened from the "12m revenue" box on Repricing's Status tab (owner, 2026-10-14: "On the WINNERS screen we
         have our revenue. I want to click on the card and go to the breakdown ... enough information to know how we are
         progressing"). The rolling 12 months split by channel (Shopify / Amazon / CM3), each figure beside the same figure for the 12
         months before (the year before, owner 2026-10-14). The page is a card per channel, which the owner will extend with each
         channel's expenses to see what is left.

         REVENUE = SUM(soldprice * qty), the same sum the Winners figure stamps (utils/portfolioStatus.js), so it is NET OF RETURNS
         (returns are qty < 0 rows) and VAT-INCLUSIVE — the number that reconciles with Shopify, Seller Central and the bank. `sold` and
         `returns` are the two halves of it (returns negative). Windows are the stamp's too: this year = solddate >= CURRENT_DATE - 12
         months (today included); last year = the 12 months before that. sales starts Aug 2024, so last year is complete.

         THE "12m revenue" BOX on Repricing (pricing-status-overview.js share_totals) is this same live sum since 2026-10-15, so the
         two agree. `off_file` is the part from styles deleted since and shop items with no style (~£19k on 14 Oct 2026) — the
         winners' stamped revenue can't include it.

         COST OF GOODS (2026-10-14, owner: "start with VAT and cost of goods"). Sales rows carry no cost, so it is skusummary.cost
         (read via safeNumeric) x qty — TODAY's cost, so the year before reads a little high wherever a supplier has put prices up
         since. Returns (qty < 0) put their pair's cost back.
         DELETED STYLES (2026-10-14): a Shopify SALE of a style no longer in skusummary takes the cost recovered from its stored
         sales.profit (utils/shopifyProfit.js → costFromProfitSql; it recovers today's cost to the penny on 99.8% of live-style rows,
         and shows last year's sales were stamped at today's cost too — so "today's cost" is not reading last year high on Shopify).
         Still no cost: refunds of deleted styles (a refund's profit doesn't invert), Amazon / CM3 deleted styles (different or no
         formula — test Amazon's the same way when its turn comes), junk/blank cost. Their revenue is reported as `no_cost`.
         VAT is NOT computed here: the owner's rule is revenue / 6 (kids' zero-rated sales are next to nothing), done on the page.

         SHOPIFY EXPENSES (2026-10-14) — `shopify_expenses`, each line { cur, prev } for the two windows. ONE RULE FOR ALL: real
         figures where we hold them, an AVERAGE where they run out (owner: "just show your average figure used rather than the date.
         Every now and again I can give you data to recalculate the average"). Each line returns its `rate` so the page can show the
         averages in use; fee/ads windows also split `real` and `est` so a cell can say "est." / "part est.".
           shopify_payments, paypal   fee_daily (utils/feeDaily.js). Real for the days a source covers; outside them its own rate
                                      (its fees / Shopify revenue over the days it covers) x Shopify revenue.
           advertising, shipping { name, cur, prev }   QuickFile P&L, monthly (see P&L LINES below): 6201 Advertising, all Shopify's;
                                      7501 Postage + 5003 Packaging. (Were the Google Ads import and hand-typed Royal Mail / bags
                                      until 2026-10-14.)

           delivery { cur, prev }     INCOME: what Shopify customers paid for delivery (shopify_delivery, net of refunds, inc.
                                      VAT). Not in `sales`, so not in revenue above. Free postage from 2026-10-14.

         P&L LINES (2026-10-14) — every line from the accounts comes from QuickFile's monthly P&L CSV (scripts/pl-import.js; code → line
         mapping in utils/quickFilePL.js), one expense_figure row per line per month. A window's amount = the months inside it, part
         months pro rata by days; days no month covers (the current month, until it has ended and been imported) are filled at the
         window's own daily rate. Owner, 2026-10-14: monthly because QuickFile won't give a rolling 12 months, and shoe sales are too
         seasonal to scale a part year up.

         KEEPING IT CURRENT (the page's "What to provide" says the same, briefly):
           - Every month or two: QuickFile → Segmented P&L by Months → CSV Download → node scripts/pl-import.js <csv> --apply.
           - Now and then: a PayPal "All transactions" export → node scripts/paypal-fees-import.js <csv> --apply.
           Shopify Payments fees and delivery need nothing: "Update now" on Repricing tops them up.

         AMAZON (2026-10-14) — `amazon_expenses.fees` { cur, prev }: the P&L's 6003 Seller Fees (expense_figure AMZ 'Seller fees',
         by days) less shopify_payments and paypal above. `amazon_expenses.shipping` { cur, prev }: the P&L's 5100 Carriage (DPD to
         Amazon; owner, 2026-10-15 — 7501 Postage stays all Shopify's). Deleted Amazon / CM3 styles' revenue costed at the channel's own cost ratio
         (`cogs_filled`).

         ACCOUNTS TURNOVER (2026-10-14) — `accounts_turnover` { cur, prev }: the P&L's 4000 General Sales (ex VAT), so the page can show
         the accounts beside our sales. Not used in any sum. It exposed that `sales` is ~£82k short in the year before (Nov 2024 – Feb
         2025 especially) while this year agrees.

         OVERHEADS (2026-10-14) — `overheads` [{ name, cur, prev }]: Wages (7004 + 7007 pensions), Rent (7100), General expenses
         (every other P&L expense line; NOT 5100 Carriage, Amazon's shipping; 5000 purchases — cost of goods is ours — 5003/7501 shipping, 6003 seller
         fees, 6201 advertising, which the channels carry). expense_figure channel 'ALL'.

         STOCK (2026-10-15) — `stock` { value, units, prev_value, avg_value, turn }: cash in stock now at cost (utils/financeStock.js),
         the stock a year ago (stock_daily), and the turn = this year's cost of goods / average stock over the year. See the code.

         Channels are whatever `sales.channel` holds (SHP / AMZ / CM3 today), largest first; an unknown code still shows, never dropped.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "from": "2025-10-14", "to": "2026-10-14",           // this window, inclusive (London-ish: CURRENT_DATE of the pg session)
  "prev_from": "2024-10-14", "prev_to": "2025-10-13",
  "channels": [
    { "channel": "SHP", "revenue": 218833.20, "sold": 252250.81, "returns": -33417.61, "units": 3698,
      "prev_revenue": 153106.65, "prev_sold": ..., "prev_returns": ..., "prev_units": ...,   // the same four, the year before
      "off_file": 5448.13,
      "cogs": 120000.00, "prev_cogs": ...,          // cost of goods, ex VAT, at TODAY's skusummary.cost, returns put back
      "no_cost": 5600.00, "prev_no_cost": ... }, ...   // revenue with no usable cost (deleted styles, junk cost) — not in cogs
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { safeNumeric } = require('../utils/sql');
const { costFromProfitSql } = require('../utils/shopifyProfit');
const { stockValue } = require('../utils/financeStock');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One pass over 24 months; FILTER splits the two windows. `cur` mirrors the Winners stamp's window exactly.
    const r = await query(`
      WITH w AS (
        SELECT s.channel, s.qty, s.soldprice * s.qty AS v,
               s.solddate >= CURRENT_DATE - INTERVAL '12 months' AS cur,
               ss.groupid IS NULL AS off_file,
               -- Cost of goods at TODAY's cost (sales rows carry none): a return's negative qty puts its pair back. A Shopify SALE of a
               -- style deleted since has no skusummary row, so its cost is recovered from its stored profit (see the header).
               CASE WHEN ss.groupid IS NOT NULL THEN ${safeNumeric('ss.cost')} * s.qty
                    WHEN s.channel = 'SHP' AND s.qty > 0 THEN ${costFromProfitSql('s.soldprice', 's.profit')} * s.qty
               END AS cogs
        FROM sales s
        LEFT JOIN skusummary ss ON ss.groupid = s.groupid
        WHERE s.solddate >= CURRENT_DATE - INTERVAL '24 months'
      )
      SELECT COALESCE(NULLIF(channel, ''), '?')                              AS channel,
             COALESCE(SUM(v) FILTER (WHERE cur), 0)::float8                   AS revenue,
             COALESCE(SUM(v) FILTER (WHERE cur AND qty > 0), 0)::float8       AS sold,
             COALESCE(SUM(v) FILTER (WHERE cur AND qty < 0), 0)::float8       AS returns,
             COALESCE(SUM(qty) FILTER (WHERE cur), 0)::int                    AS units,
             COALESCE(SUM(v) FILTER (WHERE NOT cur), 0)::float8               AS prev_revenue,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND qty > 0), 0)::float8   AS prev_sold,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND qty < 0), 0)::float8   AS prev_returns,
             COALESCE(SUM(qty) FILTER (WHERE NOT cur), 0)::int                AS prev_units,
             COALESCE(SUM(v) FILTER (WHERE cur AND off_file), 0)::float8      AS off_file,
             COALESCE(SUM(cogs) FILTER (WHERE cur), 0)::float8                AS cogs,
             COALESCE(SUM(cogs) FILTER (WHERE NOT cur), 0)::float8            AS prev_cogs,
             COALESCE(SUM(v) FILTER (WHERE cur AND cogs IS NULL), 0)::float8      AS no_cost,
             COALESCE(SUM(v) FILTER (WHERE NOT cur AND cogs IS NULL), 0)::float8  AS prev_no_cost
      FROM w
      GROUP BY 1
      ORDER BY 2 DESC
    `);
    const d = await query(`
      SELECT (CURRENT_DATE - INTERVAL '12 months')::date::text AS from,
             CURRENT_DATE::text                                 AS to,
             (CURRENT_DATE - INTERVAL '24 months')::date::text AS prev_from,
             (CURRENT_DATE - INTERVAL '12 months' - INTERVAL '1 day')::date::text AS prev_to
    `);
    const r2 = (x) => Math.round(x * 100) / 100;
    // AMAZON / CM3 UNCOSTED REVENUE (2026-10-14): a deleted style's sales have no cost, and Amazon's stored profit can't give it back
    // (its formula carries the FBA fee, which moves — inverting it matched today's cost on only 67% of live rows). So that revenue is
    // costed at the channel's OWN cost ratio on the revenue that has a cost. `cogs_filled` is the part added, for the footnote.
    // Shopify keeps its recovery from stored profit (above); its only leftover is refunds on deleted styles, left as they are.
    const fill = (c, cogs, rev, noCost) => (c.channel === 'SHP' || rev - noCost === 0 ? 0 : noCost * (cogs / (rev - noCost)));
    const channels = r.rows.map((c) => {
      const f = fill(c, c.cogs, c.revenue, c.no_cost), pf = fill(c, c.prev_cogs, c.prev_revenue, c.prev_no_cost);
      return {
        channel: c.channel, revenue: r2(c.revenue), sold: r2(c.sold), returns: r2(c.returns), units: c.units,
        prev_revenue: r2(c.prev_revenue), prev_sold: r2(c.prev_sold), prev_returns: r2(c.prev_returns), prev_units: c.prev_units,
        off_file: r2(c.off_file),
        cogs: r2(c.cogs + f), prev_cogs: r2(c.prev_cogs + pf), no_cost: r2(c.no_cost), prev_no_cost: r2(c.prev_no_cost),
        cogs_filled: r2(f), prev_cogs_filled: r2(pf),
      };
    });
    const [shopify_expenses, overheads, sellerFees, turnover, amzShipping, now, hist] = await Promise.all([
      shopifyExpenses(), overheadLines(), plLines({ query }, 'AMZ', 'Seller fees'), plLines({ query }, 'ACC', 'Turnover'),
      plLines({ query }, 'AMZ', 'Shipping'),
      stockValue(),
      // STOCK HISTORY (stock_daily, nightly, backfilled from 14 Oct 2025): the average over this window, for the turn, and the
      // reading a year ago. No history before that, so the year before has no turn.
      query(`
        SELECT AVG(value)::float8 AS avg_value, COUNT(*)::int AS days,
               (SELECT value::float8 FROM stock_daily
                WHERE snapshot_date <= CURRENT_DATE - INTERVAL '12 months' ORDER BY snapshot_date DESC LIMIT 1) AS year_ago,
               (SELECT value::float8 FROM stock_daily ORDER BY snapshot_date LIMIT 1) AS first_value
        FROM stock_daily WHERE snapshot_date >= CURRENT_DATE - INTERVAL '12 months'
      `),
    ]);
    const h = hist.rows[0] || {};
    // CASH IN STOCK (owner, 2026-10-15) = the stock we own at cost, ex VAT (utils/financeStock.js, the Month End figure).
    // STOCK TURN = the year's cost of goods / the year's AVERAGE stock at cost — how many times the money in stock came back.
    // Days = 365 / turn. Year before: the stock a year ago (or the first reading, a day short), no turn.
    const cogsAll = channels.reduce((a, c) => a + c.cogs, 0);
    const stock = {
      value: now.value, units: now.units,
      prev_value: h.year_ago ?? h.first_value ?? null,
      avg_value: h.avg_value ? r2(h.avg_value) : null,
      turn: h.avg_value ? Math.round((cogsAll / h.avg_value) * 10) / 10 : null,
    };
    // AMAZON FEES (owner, 2026-10-14) = the QuickFile P&L's 6003 Seller Fees, which holds EVERY channel's fees (Month End posts
    // Amazon's, Shopify's and PayPal's there — utils/financeQuickFile.js), less the Shopify Payments and PayPal fees this screen
    // already holds. What remains is Amazon's (referral, FBA, storage, subscription; SumUp's few pounds too). Ex VAT, as the P&L.
    const sf = sellerFees[0] || { cur: null, prev: null };
    const amzFees = (w) => (sf[w] === null ? null
      : r2(sf[w] - (shopify_expenses.shopify_payments[w].amount || 0) - (shopify_expenses.paypal[w].amount || 0)));
    const amzShip = amzShipping[0] || { cur: null, prev: null };
    const amazon_expenses = { fees: { cur: amzFees('cur'), prev: amzFees('prev') }, seller_fees: sf,
      shipping: { cur: amzShip.cur, prev: amzShip.prev } };
    const accounts_turnover = turnover[0] ? { cur: turnover[0].cur, prev: turnover[0].prev } : null;
    return res.json({ return_code: 'SUCCESS', ...d.rows[0], channels, shopify_expenses, amazon_expenses, overheads, accounts_turnover, stock });
  } catch (err) {
    logger.error('[analytics-revenue] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Revenue' });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// SHOPIFY EXPENSES (see the header). Four reads, each giving { cur, prev } for the same two windows as the channels above.
// ---------------------------------------------------------------------------------------------------------------------------------

const WINDOWS_SQL = `
  SELECT 'cur' AS w, (CURRENT_DATE - INTERVAL '12 months')::date AS f, CURRENT_DATE AS t
  UNION ALL
  SELECT 'prev', (CURRENT_DATE - INTERVAL '24 months')::date, (CURRENT_DATE - INTERVAL '12 months' - INTERVAL '1 day')::date`;

async function shopifyExpenses(db = { query }) {   // db: a transaction client in the rollback test, else the pool
  const [fees, delivery, advertising, shipping] = await Promise.all([
    // FEES: real where fee_daily covers the day; outside a source's covered range, its own real rate (fees / Shopify revenue over
    // the covered range) x that day's Shopify revenue. rate NULL = nothing stored for the source yet, so no estimate either.
    db.query(`
      WITH win AS (${WINDOWS_SQL}),
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
      WITH win AS (${WINDOWS_SQL})
      SELECT w.w, COALESCE(SUM(d.charged - d.refunded), 0)::float8 AS amount
      FROM win w LEFT JOIN shopify_delivery d ON d.order_day BETWEEN w.f AND w.t
      GROUP BY w.w
    `),
    // ADVERTISING (owner, 2026-10-14: "take advertising from the P&L and charge it to shopify. It will be the most accurate") — the P&L's
    // 6201, all of it Shopify's (no Amazon ads). Replaced the google_product_daily sum, which missed ~£17k of other channels the
    // year before. SHIPPING — the P&L's 7501 Postage and Carriage + 5003 Packaging.
    plLines(db, 'SHP', 'Advertising'),
    plLines(db, 'SHP', 'Shipping'),
  ]);

  const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
  const feeLine = (source) => {
    const at = (w) => {
      const x = fees.rows.find((f) => f.source === source && f.w === w);
      const est = x.rate === null ? null : (x.uncovered_rev || 0) * x.rate;
      const real_days = x.real_from && x.real_to && x.real_from <= x.real_to ? { from: x.real_from, to: x.real_to } : null;
      return { amount: r2(x.real + (est || 0)), real: r2(x.real), est: r2(est), rate: x.rate, real_days };
    };
    return { cur: at('cur'), prev: at('prev') };
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
function overheadLines(db = { query }) {
  return plLines(db, 'ALL', null);
}

// A P&L line per window (see P&L LINES in the header): the monthly rows inside the window, part months pro rata by days, then scaled
// up for any days no month covers (amount x window days / covered days). Months never overlap — pl-import.js replaces a month
// rather than adding a second row. name null = every name on the channel. null where nothing covers the window at all.
async function plLines(db, channel, only) {
  const r = await db.query(`
    WITH win AS (${WINDOWS_SQL}),
    fig AS (SELECT name, amount, period_from AS f, period_to AS t FROM expense_figure
            WHERE channel = $1 AND ($2::text IS NULL OR name = $2)),
    o AS (SELECT fig.name, w.w, (w.t - w.f + 1) AS days, fig.amount, (fig.t - fig.f + 1) AS len,
                 GREATEST(0, LEAST(fig.t, w.t) - GREATEST(fig.f, w.f) + 1) AS overlap
          FROM fig CROSS JOIN win w)
    SELECT name, w, SUM(amount * overlap / len)::float8 AS amount, SUM(overlap)::int AS covered, MAX(days)::int AS days
    FROM o GROUP BY name, w
  `, [channel, only]);
  const r2 = (x) => Math.round(x * 100) / 100;
  const at = (name, w) => {
    const x = r.rows.find((y) => y.name === name && y.w === w);
    return x && x.covered > 0 ? r2(x.amount * x.days / x.covered) : null;
  };
  return [...new Set(r.rows.map((x) => x.name))]
    .map((name) => ({ name, cur: at(name, 'cur'), prev: at(name, 'prev') }))
    .sort((a, b) => (b.cur || 0) - (a.cur || 0));
}

module.exports = router;
module.exports.shopifyExpenses = shopifyExpenses;   // for the rollback test only
module.exports.overheadLines = overheadLines;
module.exports.plLines = plLines;
