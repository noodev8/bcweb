/*
=======================================================================================================================================
API Route: amz_all_list
=======================================================================================================================================
Method: GET
Purpose: Amazon Pricing's home list — EVERY in-stock Amazon SKU, not one segment (owner, 2026-10-26: "shouldn't go off segments —
         just be a list of all, with a due and not due toggle"). Membership = an amzfeed listing with live FBA stock (amzlive > 0).
         One unsplit list: no Selling / Stuck bars.

         Same row shape as amz-status-list / amz-process-list, so /amz/all?by=all renders it with the same table, drill, Due switch,
         bulk bar and upload basket. Apply is unchanged: amz_price_log + the Seller Central upload; amzfeed stays READ ONLY.

         Order: most FBA stock first, then code. Parked SKUs (skumap.next_amz_price_review in the future) are dropped unless
         ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /amz-all-list[?parked=include][&limit=N]
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "total": 233, "truncated": false, "out_of_stock": 0,
  "rows": [ { "rank": 1, "code": "…-38", "amz_sku": "…", "groupid": "…", "size": "38", "title": "…", "brand": "…", "price": 42.5,
              "rrp": 60, "fba": 4, "units": 3, "u7": 1, "last_sold": "2026-10-20", "next_review": null, "parked": false }, ... ]
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
const { safeNumeric } = require('../utils/sql');
const { parseListLimit } = require('../utils/listLimit');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // $1 limit, $2 includeParked. Units / last sold are Amazon's, as on the other Amazon lists.
    const result = await query(`
      WITH u AS (
        SELECT code,
               SUM(qty) AS u30,
               COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 7), 0) AS u7
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY code
      ),
      ls AS (
        SELECT code, MAX(solddate) AS last_sold FROM sales
        WHERE channel='AMZ' AND qty>0
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, SUBSTRING(a.code FROM '[^-]*$') AS size,   -- size = suffix after the last '-'
             t.shopifytitle AS title,
             NULLIF(TRIM(sk.brand), '') AS brand,
             ${safeNumeric('a.amzprice')} AS price,
             ${safeNumeric('sk.rrp')} AS rrp,
             a.amzlive             AS fba,
             COALESCE(u.u30,0)     AS units,
             COALESCE(u.u7,0)      AS u7,
             to_char(ls.last_sold,'YYYY-MM-DD') AS last_sold,
             m.next_amz_price_review::text AS next_review,                -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(m.next_amz_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m      ON m.code     = a.code
      LEFT JOIN u        ON u.code     = a.code
      LEFT JOIN ls       ON ls.code    = a.code
      LEFT JOIN title t  ON t.groupid  = a.groupid
      WHERE COALESCE(a.amzlive,0) > 0
        AND ($2::boolean OR m.next_amz_price_review IS NULL OR m.next_amz_price_review <= CURRENT_DATE)
      ORDER BY a.amzlive DESC, a.code
      LIMIT $1::int
    `, [limit, includeParked]);

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
    // out_of_stock is always 0 (membership needs FBA stock) — kept so the shape matches the other one-list routes.
    return res.json({ return_code: 'SUCCESS', total, truncated: rows.length < total, out_of_stock: 0, rows });
  } catch (err) {
    logger.error('[amz-all-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Amazon list' });
  }
});

module.exports = router;
