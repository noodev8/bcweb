/*
=======================================================================================================================================
API Route: analytics_revenue_months
=======================================================================================================================================
Method: GET
Purpose: Reports -> Revenue & profit, MONTH BY MONTH — the table that opens from the Profit tile (owner, 2026-10-26: "show the monthly on
         the revenue page as a small table ... or a drill down from the profit card"). Each of the page's 12 months (the 12 complete
         months ending at the last imported P&L month — utils/revenueFigures.js END_SQL): revenue, what the channels leave, overheads,
         profit — so the owner can see which months covered wages, rent and the rest. They add up to the page's tiles exactly.

         THE SAME SUMS AS THE 12-MONTH PAGE, NOT A COPY: every figure comes from utils/revenueFigures.js, the reads routes/
         analytics-revenue.js uses, run month by month (monthsSql) instead of over the two years. And the page adds them up with its own
         channelList(), so each month is returned SHAPED LIKE that route's response with the month in `cur` and nothing in `prev`
         (prev figures 0 / null). One rule for "what a channel leaves", whichever table shows it.

         PLUS ONE COMPARISON MONTH (owner, 2026-10-26: "last months figure but not calculated in the total. So I can compare Sep 26
         with Sep 25"): the month a year before the latest — the one that has just dropped out of the 12 — comes first, flagged
         `year_before: true`, and the page leaves it out of the total. Next month it is Oct 25, against Oct 26.

         The window already stops at the P&L's last month, so every month has its P&L. `has_pl: false` is a guard for a month with a
         gap in the imports — the page then shows its revenue but no profit, rather than a profit with no overheads taken off.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "months": [                                          // oldest first: the comparison month, then the 12
    { "month": "2025-09", "year_before": true, ... },   // a year before the latest month — NOT in the total
    { "month": "2025-10", "from": "2025-10-01", "to": "2025-10-31", "year_before": false, "has_pl": true,
      "channels": [ { "channel": "SHP", "revenue": 18233.10, "sold": ..., "returns": ..., "units": ..., "cogs": ..., ...,
                      "prev_revenue": 0, ... } ],   // as analytics-revenue's channels, this month in the plain fields
      "shopify_expenses": { "shopify_payments": { "cur": {fee}, "prev": {empty fee} }, "paypal": ..., "advertising": { "cur": 812.40, "prev": null },
                            "shipping": ..., "delivery": { "cur": 310.50, "prev": 0 } },
      "amazon_expenses": { "fees": { "cur": 2210.00, "prev": null }, "shipping": { "cur": 140.00, "prev": null } },
      "overheads": [ { "name": "Wages", "cur": 5200.00, "prev": null }, ... ] }
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
const {
  monthsSql, COGS_SQL, fillCogs, shopifyExpenses, overheadLines, plLines, amazonExpenses,
} = require('../utils/revenueFigures');

router.use(verifyToken);

// The `prev` side of a month: nothing. A fee line keeps its shape so the page's sums read it as £0.
const EMPTY_FEE = { amount: null, real: 0, est: null, rate: null, real_days: null };

// The page's 12 months plus the month a year before the latest — the comparison row, kept out of the total.
const WIN = monthsSql(13);

router.get('/', async (req, res) => {
  try {
    const win = (await query(`SELECT w, f::text AS f, t::text AS t FROM (${WIN}) m ORDER BY w`)).rows;
    const keys = win.map((m) => m.w);
    const yearBefore = keys[0];   // the oldest of the 13

    const [byChannel, shp, overheads, sellerFees, amzShipping] = await Promise.all([
      // Revenue, returns, pairs and cost of goods per month per channel — analytics-revenue's sums, by calendar month.
      query(`
        WITH win AS (${WIN}),
        x AS (
          SELECT win.w, s.channel, s.qty, s.soldprice * s.qty AS v, ss.groupid IS NULL AS off_file, ${COGS_SQL} AS cogs
          FROM win
          JOIN sales s ON s.solddate BETWEEN win.f AND win.t
          LEFT JOIN skusummary ss ON ss.groupid = s.groupid
        )
        SELECT w, COALESCE(NULLIF(channel, ''), '?')                AS channel,
               COALESCE(SUM(v), 0)::float8                           AS revenue,
               COALESCE(SUM(v) FILTER (WHERE qty > 0), 0)::float8    AS sold,
               COALESCE(SUM(v) FILTER (WHERE qty < 0), 0)::float8    AS returns,
               COALESCE(SUM(qty), 0)::int                            AS units,
               COALESCE(SUM(v) FILTER (WHERE off_file), 0)::float8   AS off_file,
               COALESCE(SUM(cogs), 0)::float8                        AS cogs,
               COALESCE(SUM(v) FILTER (WHERE cogs IS NULL), 0)::float8 AS no_cost
        FROM x GROUP BY 1, 2 ORDER BY 1, 3 DESC
      `),
      shopifyExpenses({ query }, WIN),
      overheadLines({ query }, WIN),
      plLines({ query }, 'AMZ', 'Seller fees', WIN),
      plLines({ query }, 'AMZ', 'Shipping', WIN),
    ]);
    const amz = amazonExpenses(sellerFees, amzShipping, shp, keys);

    const r2 = (x) => Math.round(x * 100) / 100;
    // Deleted Amazon / CM3 styles are costed at the channel's cost ratio over the WHOLE 12 months, as the page's tiles are — a ratio
    // per month would fill a slightly different total (£51 on 26 Oct 2026), and the months must add up to the tiles exactly.
    // fillCogs(…, no_cost = 1) is that ratio per £ of uncosted revenue. The comparison month isn't one of the 12, so it doesn't feed
    // the ratio; it is costed at it (near enough for a comparison).
    const year = {};
    for (const c of byChannel.rows.filter((r) => r.w !== yearBefore)) {
      const y = (year[c.channel] ||= { cogs: 0, revenue: 0, no_cost: 0 });
      y.cogs += c.cogs; y.revenue += c.revenue; y.no_cost += c.no_cost;
    }
    const ratio = (ch) => { const y = year[ch]; return y?.no_cost ? fillCogs(ch, y.cogs, y.revenue, y.no_cost) / y.no_cost : 0; };
    const months = win.map(({ w, f, t }) => {
      const channels = byChannel.rows.filter((c) => c.w === w).map((c) => {
        const fill = c.no_cost * ratio(c.channel);
        return {
          channel: c.channel, revenue: r2(c.revenue), sold: r2(c.sold), returns: r2(c.returns), units: c.units,
          off_file: r2(c.off_file), cogs: r2(c.cogs + fill), no_cost: r2(c.no_cost), cogs_filled: r2(fill),
          prev_revenue: 0, prev_sold: 0, prev_returns: 0, prev_units: 0, prev_cogs: 0, prev_no_cost: 0, prev_cogs_filled: 0,
        };
      });
      const line = (l, name) => ({ name: l?.name ?? name, cur: l?.[w] ?? null, prev: null });
      const oh = overheads.map((l) => line(l));
      return {
        month: w, from: f, to: t,
        year_before: w === yearBefore,   // the comparison row: shown, NOT in the total
        // Overheads are the P&L's 'ALL' lines; none for the month = its P&L isn't imported, so no profit can be given.
        has_pl: oh.some((l) => l.cur !== null),
        channels,
        shopify_expenses: {
          shopify_payments: { cur: shp.shopify_payments[w] ?? EMPTY_FEE, prev: EMPTY_FEE },
          paypal: { cur: shp.paypal[w] ?? EMPTY_FEE, prev: EMPTY_FEE },
          advertising: line(shp.advertising, 'Advertising'),
          shipping: line(shp.shipping, 'Shipping'),
          delivery: { cur: shp.delivery[w] ?? 0, prev: 0 },
        },
        amazon_expenses: { fees: { cur: amz.fees[w], prev: null }, shipping: { cur: amz.shipping[w], prev: null } },
        overheads: oh,
      };
    });
    return res.json({ return_code: 'SUCCESS', months });
  } catch (err) {
    logger.error('[analytics-revenue-months] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the months' });
  }
});

module.exports = router;
