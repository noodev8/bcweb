/*
=======================================================================================================================================
API Route: pricing_all_list
=======================================================================================================================================
Method: GET
Purpose: Shopify Pricing's home list — EVERY in-stock Shopify style, not one segment (owner, 2026-10-26: "shouldn't go off segments —
         just be a list of all, with a due and not due toggle"). Membership = live on Shopify (skusummary.shopify = 1) with sellable
         local stock (localstock #FREE — CLAUDE.md, never stockvariants). One unsplit list: no Selling / Stuck bars.

         Same row shape as pricing-status-list, so /pricing/all?by=all renders it with the same table, drill,
         Due switch and bulk bar. Apply is the usual W1.

         Order: most stock first, then groupid. Parked styles (skusummary.next_shopify_price_review in the future) are dropped unless
         ?parked=include — the Due switch.

Requires auth.
=======================================================================================================================================
Request: GET /pricing-all-list[?parked=include][&limit=N]
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "total": 205, "truncated": false, "out_of_stock": 0,
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "brand": "…", "price": 69.95, "rrp": 85, "stock": 5, "u30": 2,
              "match_amazon": false, "next_review": null, "parked": false }, ... ]
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

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // $1 limit, $2 includeParked. Stock and 30-day units as on pricing-status-list (the shared table).
    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      win AS (
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,
             st.stock,
             COALESCE(w.u30, 0) AS u30,
             ss.match_amazon_price AS match_amazon,
             t.shopifytitle,
             NULLIF(TRIM(ss.brand), '') AS brand,
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked,
             COUNT(*) OVER () AS total_rows
      FROM skusummary ss
      JOIN stk st       ON st.groupid = ss.groupid
      LEFT JOIN win w   ON w.groupid  = ss.groupid
      LEFT JOIN title t ON t.groupid  = ss.groupid
      WHERE ss.shopify = 1
        AND ($2::boolean OR ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= CURRENT_DATE)
      ORDER BY st.stock DESC, ss.groupid
      LIMIT $1::int
    `, [limit, includeParked]);

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
    // out_of_stock is always 0 (membership needs stock) — kept so the row/summary shape matches the other one-list routes.
    return res.json({ return_code: 'SUCCESS', total, truncated: rows.length < total, out_of_stock: 0, rows });
  } catch (err) {
    logger.error('[pricing-all-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Shopify list' });
  }
});

module.exports = router;
