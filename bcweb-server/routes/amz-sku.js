/*
=======================================================================================================================================
API Route: amz_sku
=======================================================================================================================================
Method: GET
Purpose: The "dig deeper" drill for ONE Amazon SKU (one size), loaded lazily when the operator expands a row on the /amz screen. It
         gives the evidence behind the suggested move so a decision is a real decision, not a rubber-stamp (see docs/amz-pricing-spec.md
         §2/§5). Three datasets, all read-only:
           1. weeks  — 6-week velocity, zero-filled: units, returns, avg sold price, profit per week. Shows the TREND (a halving week
                       over week is the act-now signal; a gap week reads as 0, not a hidden hole).
           2. history — this SKU's recent amz_price_log rows (date, old→new, direction, the note that captured the reasoning). The note
                        is where the real "why did we last move this" lives.
           3. bands  — units sold at each distinct price over 60 days (the stalling-creep guardrail from AMZ_FULL_REVIEW.md): if units
                       dry up above a price, that price is the discovered ceiling; a creep past it needs a reason.

Never writes; amzfeed is untouched. Sales are channel='AMZ' only (qty<0 = a return).
=======================================================================================================================================
Request Query Params:
  code   (string, required)  - our SKU (amzfeed.code / sales.code), e.g. 'FLE030-IVES-WHITE-05'
  limit  (int, optional)     - max history rows; default 8

Success Response:
{
  "return_code": "SUCCESS",
  "code": "FLE030-IVES-WHITE-05",
  "weeks":   [ { "week_start": "2026-06-01", "units": 9, "returns": 0, "avg_price": 39.82, "profit": 154.74 }, ... ],  // oldest→newest
  "history": [ { "log_date": "2026-06-14", "old_price": 39.69, "new_price": 39.29, "direction": "drop", "notes": "…" }, ... ],
  "bands":   [ { "price": 38.99, "units": 49, "first": "2026-05-16", "last": "2026-05-29" }, ... ]  // ascending price
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
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

const num = (v) => (v == null ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    const limit = Number.parseInt(req.query.limit, 10) > 0 ? Number.parseInt(req.query.limit, 10) : 8;
    if (!code) return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });

    // Run the three reads in parallel — they're independent.
    const [weeksR, historyR, bandsR] = await Promise.all([
      // 6 weeks (current week + 5 prior), zero-filled so a dead week shows as 0 rather than vanishing.
      query(`
        WITH wk AS (
          SELECT generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks',
                                 date_trunc('week', CURRENT_DATE), INTERVAL '1 week')::date AS week_start
        ),
        s AS (
          SELECT date_trunc('week', solddate)::date AS week_start,
                 SUM(CASE WHEN qty>0 THEN qty ELSE 0 END)::int AS units,
                 SUM(CASE WHEN qty<0 THEN ABS(qty) ELSE 0 END)::int AS returns,
                 ROUND(AVG(CASE WHEN qty>0 THEN soldprice END)::numeric, 2) AS avg_price,
                 ROUND(SUM(profit)::numeric, 2) AS profit
          FROM sales
          WHERE channel='AMZ' AND code=$1 AND solddate >= date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks'
          GROUP BY 1
        )
        SELECT to_char(wk.week_start, 'YYYY-MM-DD') AS week_start,
               COALESCE(s.units,0) AS units, COALESCE(s.returns,0) AS returns,
               s.avg_price, COALESCE(s.profit,0) AS profit
        FROM wk LEFT JOIN s USING (week_start)
        ORDER BY wk.week_start
      `, [code]),

      query(`
        SELECT to_char(log_date, 'YYYY-MM-DD') AS log_date, old_price, new_price,
               CASE WHEN new_price>old_price THEN 'creep' WHEN new_price<old_price THEN 'drop' ELSE 'flat' END AS direction,
               COALESCE(notes,'') AS notes
        FROM amz_price_log WHERE code=$1 ORDER BY id DESC LIMIT $2
      `, [code, limit]),

      query(`
        SELECT soldprice::numeric AS price, SUM(qty)::int AS units,
               to_char(MIN(solddate), 'YYYY-MM-DD') AS first, to_char(MAX(solddate), 'YYYY-MM-DD') AS last
        FROM sales
        WHERE channel='AMZ' AND code=$1 AND qty>0 AND solddate >= CURRENT_DATE - 60
        GROUP BY soldprice ORDER BY soldprice
      `, [code]),
    ]);

    const weeks = weeksR.rows.map((r) => ({
      week_start: r.week_start, units: Number(r.units), returns: Number(r.returns),
      avg_price: num(r.avg_price), profit: Number(r.profit),
    }));
    const history = historyR.rows.map((r) => ({
      log_date: r.log_date, old_price: num(r.old_price), new_price: num(r.new_price),
      direction: r.direction, notes: r.notes,
    }));
    const bands = bandsR.rows.map((r) => ({
      price: num(r.price), units: Number(r.units), first: r.first, last: r.last,
    }));

    return res.json({ return_code: 'SUCCESS', code, weeks, history, bands });
  } catch (err) {
    logger.error('[amz-sku] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load SKU detail' });
  }
});

module.exports = router;
