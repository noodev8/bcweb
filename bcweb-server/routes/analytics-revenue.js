/*
=======================================================================================================================================
API Route: analytics_revenue
=======================================================================================================================================
Method: GET
Purpose: Reports -> Revenue, opened from the "12m revenue" box on Repricing's Status tab (owner, 2026-10-14: "On the WINNERS screen we
         have our revenue. I want to click on the card and go to the breakdown ... enough information to know how we are
         progressing"). The last 12 COMPLETE months split by channel (Shopify / Amazon / CM3), each figure beside the same figure for
         the 12 months before (the year before, owner 2026-10-14). The page is a card per channel, which the owner will extend with each
         channel's expenses to see what is left.

         WINDOWS (owner, 2026-10-26: "remove the current month where we dont have enough data. Always from last month"): this year =
         the 12 whole months ending last month — or the last month the QuickFile P&L covers, if that isn't imported yet; the year
         before = the 12 months before that. utils/revenueFigures.js (END_SQL) has the rule and why; its month-by-month table
         (routes/analytics-revenue-months.js) covers the same 12 months, so the Profit tile and the table's total agree.

         REVENUE = SUM(soldprice * qty), the same sum the Winners figure stamps (utils/portfolioStatus.js), so it is NET OF RETURNS
         (returns are qty < 0 rows) and VAT-INCLUSIVE — the number that reconciles with Shopify, Seller Central and the bank. `sold` and
         `returns` are the two halves of it (returns negative). sales starts Aug 2024, so the year before is complete.

         THE "12m revenue" BOX on Repricing (pricing-status-overview.js share_totals) is the same sum but ROLLING TO TODAY (the winner
         shares need today's figure), so since 2026-10-26 it no longer equals this page's revenue — its label says "to today".
         `off_file` is the part from styles deleted since and shop items with no style (~£19k on 14 Oct 2026) — the winners' stamped
         revenue can't include it.

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
const { stockValue } = require('../utils/financeStock');
// The expense / cost reads, shared with the month-by-month table (routes/analytics-revenue-months.js) so the two can't drift.
const {
  WINDOWS_SQL, COGS_SQL, fillCogs, shopifyExpenses, overheadLines, plLines, amazonExpenses,
} = require('../utils/revenueFigures');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One pass over the two windows (the 12 complete P&L months and the 12 before — utils/revenueFigures.js); FILTER splits them.
    const r = await query(`
      WITH win AS (${WINDOWS_SQL}),
      w AS (
        SELECT s.channel, s.qty, s.soldprice * s.qty AS v,
               win.w = 'cur' AS cur,
               ss.groupid IS NULL AS off_file,
               -- Cost of goods at TODAY's cost; deleted Shopify styles' from their stored profit (see the header, utils/revenueFigures.js).
               ${COGS_SQL} AS cogs
        FROM win
        JOIN sales s ON s.solddate BETWEEN win.f AND win.t
        LEFT JOIN skusummary ss ON ss.groupid = s.groupid
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
      WITH win AS (${WINDOWS_SQL})
      SELECT MAX(f::text) FILTER (WHERE w = 'cur') AS from, MAX(t::text) FILTER (WHERE w = 'cur') AS to,
             MAX(f::text) FILTER (WHERE w = 'prev') AS prev_from, MAX(t::text) FILTER (WHERE w = 'prev') AS prev_to
      FROM win
    `);
    const r2 = (x) => Math.round(x * 100) / 100;
    // Amazon / CM3 deleted styles' cost at the channel's own cost ratio (utils/revenueFigures.js → fillCogs). `cogs_filled` is the
    // part added, for the footnote.
    const channels = r.rows.map((c) => {
      const f = fillCogs(c.channel, c.cogs, c.revenue, c.no_cost), pf = fillCogs(c.channel, c.prev_cogs, c.prev_revenue, c.prev_no_cost);
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
      // reading a year ago (cash in stock is NOW against then — a point in time, not a window). No history before that, so the year
      // before has no turn.
      query(`
        WITH win AS (${WINDOWS_SQL})
        SELECT AVG(value)::float8 AS avg_value, COUNT(*)::int AS days,
               (SELECT value::float8 FROM stock_daily
                WHERE snapshot_date <= CURRENT_DATE - INTERVAL '12 months' ORDER BY snapshot_date DESC LIMIT 1) AS year_ago,
               (SELECT value::float8 FROM stock_daily ORDER BY snapshot_date LIMIT 1) AS first_value
        FROM stock_daily, win WHERE win.w = 'cur' AND snapshot_date BETWEEN win.f AND win.t
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
    // AMAZON FEES = the P&L's seller fees less Shopify's and PayPal's; shipping = DPD to Amazon (utils/revenueFigures.js).
    const amazon_expenses = amazonExpenses(sellerFees, amzShipping, shopify_expenses);
    const accounts_turnover = turnover[0] ? { cur: turnover[0].cur, prev: turnover[0].prev } : null;
    return res.json({ return_code: 'SUCCESS', ...d.rows[0], channels, shopify_expenses, amazon_expenses, overheads, accounts_turnover, stock });
  } catch (err) {
    logger.error('[analytics-revenue] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Revenue' });
  }
});

module.exports = router;
