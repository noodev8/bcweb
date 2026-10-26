/*
=======================================================================================================================================
API Route: pricing_process_list
=======================================================================================================================================
Method: GET
Purpose: The Shopify repricer list behind a card on the Process screen — the Shopify twin of routes/amz-process-list.js (owner,
         2026-10-25: the Process cards send you to the screen where you act). First and only list so far:

           unsold-local   Process → Unsold → LOCAL ONLY: styles with a new size (created in the last 90 days) that has sold nothing on
                          any channel, held locally and not at FBA — check the Shopify price, or decide to send it to Amazon. Rules:
                          utils/processMap.js → UNSOLD_LOCAL_STYLES_SQL, the same as the card.

         Same row shape as pricing-status-list, so /pricing/[segment]?by=process renders it with the same table, drill, Due switch and
         bulk bar. No lead-channel filter (these are new). Apply is the usual W1.

         Order: oldest added first (longest without a sale at the top, as on the Process screen), then groupid. Parked styles
         (skusummary.next_shopify_price_review in the future) are dropped unless ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /pricing-process-list?list=unsold-local[&parked=include][&limit=N]
  list     required — 'unsold-local'. Anything else -> MISSING_FIELDS.
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "list": "unsold-local",
  "total": 21, "truncated": false, "out_of_stock": 0,
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "brand": "…", "price": 69.95, "rrp": 85, "stock": 5, "u30": 0,
              "match_amazon": false, "next_review": null, "parked": false }, ... ]
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
const { NEW_DAYS, UNSOLD_LOCAL_STYLES_SQL } = require('../utils/processMap');
const logger = require('../utils/logger');

router.use(verifyToken);

// list name -> the CTE body that picks its styles ($1 = NEW_DAYS).
const LISTS = { 'unsold-local': UNSOLD_LOCAL_STYLES_SQL };

router.get('/', async (req, res) => {
  try {
    const list = typeof req.query.list === 'string' ? req.query.list : '';
    const stylesSql = LISTS[list];
    if (!stylesSql) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'list must be one of ' + Object.keys(LISTS).join(', ') });
    }
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // $1 NEW_DAYS (the styles CTE), $2 limit, $3 includeParked. Stock and 30-day units as on pricing-status-list (the shared table).
    const result = await query(`
      WITH ps AS (${stylesSql}),
      stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0 AND groupid IN (SELECT groupid FROM ps)
        GROUP BY groupid
      ),
      win AS (
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30 AND groupid IN (SELECT groupid FROM ps)
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,
             COALESCE(st.stock, 0) AS stock,
             COALESCE(w.u30, 0) AS u30,
             ss.match_amazon_price AS match_amazon,
             t.shopifytitle,
             NULLIF(TRIM(ss.brand), '') AS brand,
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows,
             COUNT(*) FILTER (WHERE st.stock IS NULL) OVER () AS oos_rows
      FROM skusummary ss
      JOIN ps           ON ps.groupid = ss.groupid
      LEFT JOIN stk st  ON st.groupid = ss.groupid
      LEFT JOIN win w   ON w.groupid  = ss.groupid
      LEFT JOIN title t ON t.groupid  = ss.groupid
      WHERE ($3::boolean OR ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)
      ORDER BY ss.created_at, ss.groupid
      LIMIT $2::int
    `, [NEW_DAYS, limit, includeParked]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      groupid: r.groupid,
      title: r.shopifytitle || null,
      brand: r.brand || null,
      price: r.price === null || r.price === undefined ? null : Number(r.price),   // null when the legacy VARCHAR held junk/blank
      rrp: r.rrp === null || r.rrp === undefined ? null : Number(r.rrp),
      stock: Number(r.stock),
      u30: Number(r.u30),
      match_amazon: r.match_amazon === true,
      next_review: r.next_review || null,
      parked: r.parked === true,
    }));

    const total = result.rows.length > 0 ? Number(result.rows[0].total_rows) : 0;
    const outOfStock = result.rows.length > 0 ? Number(result.rows[0].oos_rows) : 0;
    return res.json({ return_code: 'SUCCESS', list, total, truncated: rows.length < total, out_of_stock: outOfStock, rows });
  } catch (err) {
    logger.error('[pricing-process-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load process list' });
  }
});

module.exports = router;
