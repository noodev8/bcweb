/*
=======================================================================================================================================
API Route: amz_sales
=======================================================================================================================================
Method: GET
Purpose: A reference report for the Amazon drill screen — the RAW Amazon sales of one SKU, one row per sale line, each with the price it
         actually SOLD at (`soldprice`). The drill's velocity and price-band views AGGREGATE these; this is the granular view underneath,
         so the person setting a price can see the individual recent sales (date, qty, sold price, and returns). The mirror of Shopify's
         pricing-sales.

         Lazily loaded (fetched only when the operator opens the "Recent sales" section on the drill), bounded by MOST-RECENT-N rows, not a
         date window — sales are dense on a hot SKU, so a fixed cap gives a predictable payload and always shows the latest activity.
         Newest first. Amazon channel only ('AMZ'), positive sold lines only (qty>0, soldprice>0).

         Returns (qty<0) are deliberately EXCLUDED — noise for pricing intent (owner decision), matching the Shopify sales report. Size =
         RIGHT(code,2). `solddate` is a DATE — ordered by solddate then the ascending surrogate `id` for a stable newest-first sequence.
         Requires auth.
=======================================================================================================================================
Request Query Params:
  code  (string, required)
  limit (int, optional)   - max rows to return; default 50, clamped to [1, 200]

Success Response:
{
  "return_code": "SUCCESS",
  "code": "FLE030-IVES-WHITE-38",
  "rows": [
    { "solddate": "2026-07-08", "size": "38", "qty": 1, "soldprice": 37.99 },
    ... // newest first
  ],
  "limit": 50,
  "truncated": true         // true when more than `limit` rows exist (UI shows "showing last N")
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
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

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    }
    // Default 50, clamp so a client can't request an unbounded dump of a busy SKU's history.
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 50;
    if (limit > 200) limit = 200;

    const exists = await query(`SELECT 1 FROM amzfeed WHERE code = $1`, [code]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    // Fetch limit+1 to detect truncation without a separate COUNT. Newest first (solddate, then surrogate id). Positive sold lines only
    // (qty>0, soldprice>0) — returns are excluded here (noise for pricing intent, owner decision), matching the Shopify sales report.
    const result = await query(`
      SELECT to_char(solddate, 'YYYY-MM-DD') AS solddate, RIGHT(code, 2) AS size, qty, soldprice
      FROM sales
      WHERE channel='AMZ' AND code = $1 AND qty > 0 AND soldprice > 0
      ORDER BY solddate DESC, id DESC
      LIMIT $2::int
    `, [code, limit + 1]);

    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((r) => ({
      solddate: r.solddate,
      size: r.size || null,
      qty: Number(r.qty),
      soldprice: num(r.soldprice),
    }));

    return res.json({ return_code: 'SUCCESS', code, rows, limit, truncated });
  } catch (err) {
    logger.error('[amz-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sales' });
  }
});

module.exports = router;
