/*
=======================================================================================================================================
API Route: amazon_order_list
=======================================================================================================================================
Method: GET
Purpose: Landing screen for the Amazon Order module — every managed Amazon SKU (one row per size, an amzfeed row) with its Amazon
         profit, read from columns already maintained elsewhere rather than recomputed here:
           - unit_profit = skumap.amzprofit — the per-unit profit of the SKU's LAST Amazon sale (utils/amzImportApply.js ->
             projectDerivedToSkumap). STICKY: a SKU with no recent sale keeps its last-seen figure rather than going blank/zero.
           - units_30d   = amzfeed.amzsold  — units sold in a FIXED 30-day window (decision O2, utils/amzImportApply.js), kept
             comparable across SKUs by never varying with the uploaded report's date range.
           - units_7d    = amzfeed.amzsold7 — the same fixed-window idea, 7 days: the trend read against units_30d (a SKU selling
             half its 30d total in the last 7 is accelerating; one selling none of it has gone quiet).
           - profit_30d  = unit_profit * units_30d — the two multiplied together, i.e. "what this SKU actually made in 30 days" at
             its last-seen per-unit rate. Null when unit_profit is unknown (never fabricated as 0).
         There is deliberately no re-aggregation of the `sales` table here — those two source columns are already the platform's
         numbers for "how much" and "per unit", kept in step by the Update Amazon import job.

         Also carries FBA stock straight off amzfeed: fba_total = amztotal (live + inbound), fba_live = amzlive (sellable now).
         Real integers, no safeNumeric needed.

         Also carries three identifiers: barcode = skumap.ean with the legacy trailing 'B' stripped (CLAUDE.md — that suffix is an
         Excel guard for internal spreadsheets, not part of the barcode; same regexp_replace as order-status-find.js), amz_sku =
         amzfeed.sku (the Amazon Seller SKU — same field amz-drill.js reads, kept consistent with it rather than skumap.sku),
         supplier = skumap.supplier.

         NO server-side search/limit (unlike amz-all's listLimit cap): the candidate set is ~520 rows (every amzfeed SKU), so — like
         inv-styles — the whole list ships once and the Include / Does-not-contain search on the web page narrows it CLIENT-SIDE with
         no round-trip. A safety cap would only get in the way of "search everything".

Schema landmines respected: skumap.amzprofit is a junk-prone VARCHAR (2dp string) -> safeNumeric. amzfeed.amzsold is a real integer.
amzfeed is FBA-only, READ ONLY. Size = RIGHT(code,2). Human name from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 522,
  "rows": [
    { "code": "...-38", "groupid": "...", "size": "38", "title": "...", "price": 37.99,
      "units_7d": 2, "units_30d": 6, "unit_profit": 9.70, "profit_30d": 58.20, "fba_total": 12, "fba_live": 10,
      "barcode": "5057459068326", "amz_sku": "AD-0XF8D-48L", "supplier": "..." },
    ...  // profit_30d desc NULLS LAST, code as tiebreak
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
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    // skumap (amzprofit) and amzfeed (amzsold, amzprice) are both code-grain, so a straight JOIN pairs them one-to-one; skusummary
    // scopes the list to managed products only. profit_30d is computed here, not in SQL, so its "null when unit_profit is unknown"
    // rule sits next to the comment that explains it.
    const result = await query(`
      SELECT a.code, a.groupid, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzsold,0) AS units_30d,
             COALESCE(a.amzsold7,0) AS units_7d,
             ${safeNumeric('m.amzprofit')} AS unit_profit,
             COALESCE(a.amztotal,0) AS fba_total,
             COALESCE(a.amzlive,0) AS fba_live,
             regexp_replace(COALESCE(m.ean,''), 'B$', '') AS barcode,
             a.sku AS amz_sku,
             m.supplier AS supplier
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m ON m.code = a.code
      LEFT JOIN title t ON t.groupid = a.groupid
      ORDER BY ${safeNumeric('m.amzprofit')} * COALESCE(a.amzsold,0) DESC NULLS LAST, a.code
    `);

    const rows = result.rows.map((r) => {
      const units = Number(r.units_30d) || 0;
      const unitProfit = num(r.unit_profit);
      return {
        code: r.code,
        groupid: r.groupid,
        size: r.size,
        title: r.title || null,
        price: num(r.price),
        units_30d: units,
        units_7d: Number(r.units_7d) || 0,
        unit_profit: unitProfit,
        profit_30d: unitProfit === null ? null : Math.round(unitProfit * units * 100) / 100,
        fba_total: Number(r.fba_total) || 0,
        fba_live: Number(r.fba_live) || 0,
        barcode: r.barcode || null,
        amz_sku: r.amz_sku || null,
        supplier: r.supplier || null,
      };
    });

    return res.json({ return_code: 'SUCCESS', count: rows.length, rows });
  } catch (err) {
    logger.error('[amazon-order-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon Order list' });
  }
});

module.exports = router;
