/*
=======================================================================================================================================
API Route: analytics_stock_sales
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock vs Sales. Is the stock we buy shifting? Per week (or month): the units we owned at the end of it, beside the
         units sold in it. Owner, 2026-10-09: "Just sales against stock position" — to slow ordering down or speed it up.

         STOCK  = stock_daily (one reading per night, scripts/stock-daily.js; the Month End definition, utils/financeStock.js). A period's
                  stock is its CLOSING stock — the last reading inside it. The current period is open, so it shows the latest reading.
         SOLD   = `sales`, live, all channels, NET of returns (return rows carry negative qty — SUM nets them). Read live rather than
                  stored with the stock: `sales` already keeps the whole history, and a stored copy would freeze before late-booked
                  orders and refunds land (the retired google_stock_track's Shopify column ran 8 units short for Sep 2026 that way).
                  Split by channel: SHP / AMZ / CM3 (the shop). Whole-book on purpose — the stock figure includes Amazon-held units,
                  so sales must include Amazon too or the two sides don't describe the same stock.

         Periods run from the first stock reading (14 Oct 2025) to today. Weeks start Monday (date_trunc).

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  grain   'week' (default) | 'month'

Success Response:
{
  "return_code": "SUCCESS",
  "grain": "week",
  "expected_date": "2026-10-08",       // the reading the nightly job should have written by now (DB's CURRENT_DATE - 1)
  "latest": { "date": "2026-10-08", "units": 2931, "value": 86118.48, "local_units": 2187, "amz_units": 744 } | null,
  "basis_from": "2026-10-09" | null,   // first reading on the Month End basis (local/amz split known). Earlier rows are the backfill
                                       // from google_stock_track (Amazon SELLABLE only), so the line steps up here — not a real move.
  "periods": [                         // oldest -> newest
    { "start": "2026-09-29", "stock": 2850, "stock_date": "2026-10-05",
      "sold_shp": 12, "sold_amz": 80, "sold_shop": 1, "sold": 93, "partial": false }, ...
  ]
}
"stock"/"stock_date" are null for a period with no reading (the nightly job missed every night of it).
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

const GRAINS = new Set(['week', 'month']);

router.get('/', async (req, res) => {
  try {
    const grain = GRAINS.has(req.query.grain) ? req.query.grain : 'week';

    // Explicit ::timestamp before date_trunc so the bucket never depends on the session timezone. Dates go out as text (CLAUDE.md:
    // never hand a pg DATE to the JS Date parser).
    const periodsQ = query(
      `WITH bounds AS (
         SELECT MIN(snapshot_date) AS first FROM stock_daily
       ),
       periods AS (
         SELECT gs::date AS start
         FROM bounds,
              generate_series(date_trunc($1, bounds.first::timestamp),
                              date_trunc($1, CURRENT_DATE::timestamp),
                              ('1 ' || $1)::interval) AS gs
         WHERE bounds.first IS NOT NULL
       ),
       closing AS (
         SELECT DISTINCT ON (date_trunc($1, snapshot_date::timestamp))
                date_trunc($1, snapshot_date::timestamp)::date AS start, snapshot_date, units
         FROM stock_daily
         ORDER BY date_trunc($1, snapshot_date::timestamp), snapshot_date DESC
       ),
       sold AS (
         SELECT date_trunc($1, solddate::timestamp)::date AS start,
                COALESCE(SUM(qty) FILTER (WHERE channel = 'SHP'), 0)::int AS sold_shp,
                COALESCE(SUM(qty) FILTER (WHERE channel = 'AMZ'), 0)::int AS sold_amz,
                COALESCE(SUM(qty) FILTER (WHERE channel = 'CM3'), 0)::int AS sold_shop,
                COALESCE(SUM(qty), 0)::int AS sold
         FROM sales
         WHERE solddate >= (SELECT MIN(start) FROM periods)
         GROUP BY 1
       )
       SELECT to_char(p.start, 'YYYY-MM-DD') AS start,
              c.units AS stock,
              to_char(c.snapshot_date, 'YYYY-MM-DD') AS stock_date,
              COALESCE(s.sold_shp, 0) AS sold_shp,
              COALESCE(s.sold_amz, 0) AS sold_amz,
              COALESCE(s.sold_shop, 0) AS sold_shop,
              COALESCE(s.sold, 0) AS sold,
              p.start = date_trunc($1, CURRENT_DATE::timestamp)::date AS partial
       FROM periods p
       LEFT JOIN closing c ON c.start = p.start
       LEFT JOIN sold s ON s.start = p.start
       ORDER BY p.start`,
      [grain]
    );

    const metaQ = query(
      `SELECT to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') AS expected_date,
              (SELECT to_char(MIN(snapshot_date), 'YYYY-MM-DD') FROM stock_daily WHERE local_units IS NOT NULL) AS basis_from,
              l.date, l.units, l.value, l.local_units, l.amz_units
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date, units, value, local_units, amz_units
         FROM stock_daily ORDER BY snapshot_date DESC LIMIT 1
       ) l ON true`
    );

    const [p, m] = await Promise.all([periodsQ, metaQ]);
    const meta = m.rows[0];

    const latest = meta.date
      ? {
          date: meta.date,
          units: Number(meta.units),
          value: Number(meta.value),
          local_units: meta.local_units === null ? null : Number(meta.local_units),
          amz_units: meta.amz_units === null ? null : Number(meta.amz_units),
        }
      : null;

    const periods = p.rows.map((r) => ({
      start: r.start,
      stock: r.stock === null ? null : Number(r.stock),
      stock_date: r.stock_date,
      sold_shp: Number(r.sold_shp),
      sold_amz: Number(r.sold_amz),
      sold_shop: Number(r.sold_shop),
      sold: Number(r.sold),
      partial: r.partial === true,
    }));

    return res.json({
      return_code: 'SUCCESS',
      grain,
      expected_date: meta.expected_date,
      latest,
      basis_from: meta.basis_from,
      periods,
    });
  } catch (err) {
    logger.error('[analytics-stock-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Stock vs Sales' });
  }
});

module.exports = router;
