/*
=======================================================================================================================================
API Route: analytics_stock_sales
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock vs Sales. Is the stock we buy shifting? Owner, 2026-10-09: "Just sales against stock position" — the read on
         whether to slow ordering down or speed it up. Deliberately high level (owner, same day, after the first cut showed weekly
         panels, a channel split and a table: "too many things going on"): one monthly trend. The page's top number (stock split
         Selling | Sitting) comes from /analytics-stock-sitting; a sold-in-30-days figure was dropped from here 2026-10-10 with the
         old hero numbers (the list's current month, so far, carries sold).

         STOCK  = stock_daily (one reading per night, scripts/stock-daily.js; the Month End definition, utils/financeStock.js). A month's
                  stock is its CLOSING stock — the last reading inside it. The current month is open, so it shows the latest reading.
         SOLD   = `sales`, live, ALL channels (Shopify, Amazon, the shop), NET of returns (return rows carry negative qty — SUM nets
                  them). Whole-book because the stock figure includes Amazon-held units. Read live rather than stored with the stock:
                  `sales` already keeps the whole history, and a stored copy would freeze before late-booked orders and refunds land.

         Months (and weeks, for the list under the chart — owner asked for weekly too) run from the first stock reading (Oct 2025) to now.

         The backfilled readings (14 Oct 2025 -> 8 Oct 2026, local_units NULL) counted Amazon SELLABLE units only, so the line steps up
         ~3% from 9 Oct 2026. Not marked on the chart — at monthly grain it is lost in the season's swings — but it is not a delivery.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "expected_date": "2026-10-08",       // the reading the nightly job should have written by now (DB's CURRENT_DATE - 1)
  "latest": { "date": "2026-10-08", "units": 2850 } | null,
  "months": [                          // oldest -> newest
    { "start": "2026-09-01", "stock": 2954, "sold": 437, "partial": false }, ...
  ],
  "weeks": [ same shape, weeks starting Monday ]   // for the list's Week view (the chart stays monthly)
}
"stock" is null for a month with no reading (the nightly job missed every night of it).
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

router.use(verifyToken);

// One row per month or week (weeks start Monday) from the first stock reading to now: closing stock (the last reading inside the
// period) + units sold in it. Explicit ::timestamp before date_trunc so the bucket never depends on the session timezone; dates go out
// as text (CLAUDE.md: never hand a pg DATE to the JS Date parser). `grain` is one of two literals from this file, never user input.
function periodSql(grain) {
  return `WITH periods AS (
            SELECT gs::date AS start
            FROM (SELECT MIN(snapshot_date) AS first FROM stock_daily) b,
                 generate_series(date_trunc('${grain}', b.first::timestamp), date_trunc('${grain}', CURRENT_DATE::timestamp),
                                 interval '1 ${grain}') gs
            WHERE b.first IS NOT NULL
          ),
          closing AS (
            SELECT DISTINCT ON (date_trunc('${grain}', snapshot_date::timestamp))
                   date_trunc('${grain}', snapshot_date::timestamp)::date AS start, units
            FROM stock_daily
            ORDER BY date_trunc('${grain}', snapshot_date::timestamp), snapshot_date DESC
          ),
          sold AS (
            SELECT date_trunc('${grain}', solddate::timestamp)::date AS start, SUM(qty)::int AS sold
            FROM sales
            WHERE solddate >= (SELECT MIN(start) FROM periods)
            GROUP BY 1
          )
          SELECT to_char(p.start, 'YYYY-MM-DD') AS start,
                 c.units AS stock,
                 COALESCE(s.sold, 0) AS sold,
                 p.start = date_trunc('${grain}', CURRENT_DATE::timestamp)::date AS partial
          FROM periods p
          LEFT JOIN closing c ON c.start = p.start
          LEFT JOIN sold s ON s.start = p.start
          ORDER BY p.start`;
}

const shape = (r) => ({
  start: r.start,
  stock: r.stock === null ? null : Number(r.stock),
  sold: Number(r.sold),
  partial: r.partial === true,
});

router.get('/', async (req, res) => {
  try {
    const monthsQ = query(periodSql('month'));
    const weeksQ = query(periodSql('week'));

    const metaQ = query(
      `SELECT to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') AS expected_date,
              l.date, l.units
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date, units FROM stock_daily ORDER BY snapshot_date DESC LIMIT 1
       ) l ON true`
    );

    const [mo, wk, me] = await Promise.all([monthsQ, weeksQ, metaQ]);
    const meta = me.rows[0];

    return res.json({
      return_code: 'SUCCESS',
      expected_date: meta.expected_date,
      latest: meta.date ? { date: meta.date, units: Number(meta.units) } : null,
      months: mo.rows.map(shape),
      weeks: wk.rows.map(shape),
    });
  } catch (err) {
    logger.error('[analytics-stock-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Stock vs Sales' });
  }
});

module.exports = router;
