/*
=======================================================================================================================================
API Route: amz_process_list
=======================================================================================================================================
Method: GET
Purpose: The Amazon repricer list behind a card on the Process screen (owner, 2026-10-25: the Process cards send you to the screen
         where you act, not to a list of their own). First and only list so far:

           unsold-fba   Process → Unsold → AT FBA: new sizes (created in the last 90 days) that have sold nothing on any channel,
                        with FBA stock — already on Amazon and not selling, so check the price. Rules: utils/processMap.js →
                        UNSOLD_FBA_CODES_SQL, the same as the card's count.

         Same row shape as amz-status-list, so /amz/[segment]?by=process renders it with the same table, drill, Due switch, bulk bar
         and upload basket. No lead-channel filter (these are new — the status list's Amazon-led test doesn't apply). Apply is
         unchanged: amz_price_log + the Seller Central upload; amzfeed stays READ ONLY.

         Order: oldest added first (longest without a sale at the top, as on the Process screen), then code. Parked SKUs
         (skumap.next_amz_price_review in the future) are dropped unless ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /amz-process-list?list=unsold-fba[&parked=include][&limit=N]
  list     required — 'unsold-fba'. Anything else -> MISSING_FIELDS.
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "list": "unsold-fba",
  "total": 26, "truncated": false, "out_of_stock": 0,
  "rows": [ { "rank": 1, "code": "…-38", "amz_sku": "…", "groupid": "…", "size": "38", "title": "…", "brand": "…", "price": 42.5,
              "rrp": 60, "fba": 1, "units": 0, "u7": 0, "last_sold": null, "next_review": null, "parked": false }, ... ]
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
const { safeNumeric } = require('../utils/sql');
const { parseListLimit } = require('../utils/listLimit');
const { NEW_DAYS, UNSOLD_FBA_CODES_SQL } = require('../utils/processMap');
const logger = require('../utils/logger');

router.use(verifyToken);

// list name -> the CTE body that picks its codes ($1 = NEW_DAYS).
const LISTS = { 'unsold-fba': UNSOLD_FBA_CODES_SQL };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const list = typeof req.query.list === 'string' ? req.query.list : '';
    const codesSql = LISTS[list];
    if (!codesSql) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'list must be one of ' + Object.keys(LISTS).join(', ') });
    }
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // $1 NEW_DAYS (the codes CTE), $2 limit, $3 includeParked. Units / last sold are Amazon's, as on the other Amazon lists — 0 / null
    // on unsold-fba by definition, kept so the shared table reads the same.
    const result = await query(`
      WITH pc AS (${codesSql}),
      u AS (
        SELECT code,
               SUM(qty) AS u30,
               COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 7), 0) AS u7
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
          AND code IN (SELECT code FROM pc)
        GROUP BY code
      ),
      ls AS (
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0 AND code IN (SELECT code FROM pc)
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, SUBSTRING(a.code FROM '[^-]*$') AS size,   -- size = suffix after the last '-'
             t.shopifytitle AS title,
             NULLIF(TRIM(sk.brand), '') AS brand,
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.rrp')} AS rrp,
             COALESCE(a.amzlive,0) AS fba,
             COALESCE(u.u30,0)     AS units,
             COALESCE(u.u7,0)      AS u7,
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             m.next_amz_price_review::text AS next_review,                -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(m.next_amz_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows,
             COUNT(*) FILTER (WHERE COALESCE(a.amzlive,0) = 0) OVER () AS oos_rows
      FROM amzfeed a
      JOIN pc            ON pc.code    = a.code
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m      ON m.code     = a.code
      LEFT JOIN u        ON u.code     = a.code
      LEFT JOIN ls       ON ls.code    = a.code
      LEFT JOIN title t  ON t.groupid  = a.groupid
      WHERE ($3::boolean OR m.next_amz_price_review IS NULL OR m.next_amz_price_review <= CURRENT_DATE)
      ORDER BY sk.created_at, a.code
      LIMIT $2::int
    `, [NEW_DAYS, limit, includeParked]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      brand: r.brand || null,
      price: num(r.price),
      rrp: num(r.rrp),
      fba: Number(r.fba),
      units: Number(r.units),
      u7: Number(r.u7),
      last_sold: r.last_sold || null,
      next_review: r.next_review || null,
      parked: r.parked === true,
    }));

    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    const outOfStock = result.rows.length > 0 ? Number(result.rows[0].oos_rows) : 0;
    return res.json({ return_code: 'SUCCESS', list, total, truncated: rows.length < total, out_of_stock: outOfStock, rows });
  } catch (err) {
    logger.error('[amz-process-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon process list' });
  }
});

module.exports = router;
