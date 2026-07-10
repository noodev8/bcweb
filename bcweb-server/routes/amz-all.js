/*
=======================================================================================================================================
API Route: amz_all
=======================================================================================================================================
Method: GET
Purpose: The "ALL" list for a segment — every managed Amazon SKU in it, unfiltered (the mirror of Shopify's pricing-all). Unlike WINNERS
         (amz-winners) and LOSERS (amz-losers), which each apply a job-specific filter (in stock, recent sales, cover, etc.), this returns
         the WHOLE managed set for the segment: out-of-stock SKUs, dead SKUs — everything with an amzfeed row. A browse/lookup view for when
         the operator needs to find a size again ("which SKU did I just change?") without remembering which job-list it falls in.

         Rows are ordered by MOST-RECENTLY price-changed first (MAX(amz_price_log.log_date)), NULLS LAST, then code — so a SKU you just
         applied a price to sits at the top. Each row carries the current price, FBA stock, the last-change date and the last-sold date, so
         the list doubles as an at-a-glance segment overview. SKU-grain: one row per size.

Schema landmines respected: amzfeed FBA-only, READ ONLY; amzprice via safeNumeric; amzlive a real integer. Size = RIGHT(code,2). Human name
from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params:
  segment (string, required)

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "IVES-WHITE",
  "rows": [
    { "code": "...-38", "groupid": "...", "size": "38", "title": "...", "price": 37.99, "fba": 96,
      "last_change": "2026-07-08", "last_sold": "2026-07-08" },
    ... // most-recently-changed first, then code; last_change/last_sold null when none
  ]
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
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Format a pg 'date' as YYYY-MM-DD from local components (avoids a UTC day-shift). null-safe.
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // Every managed SKU in the segment. Last-change and last-sold are pre-aggregated in subqueries (so neither fans out the row set),
    // then LEFT JOINed — a SKU with no logged change / no sales simply shows NULL. Ordered recently-changed first.
    const result = await query(`
      SELECT a.code, a.groupid, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba,
             lc.last_change,
             ls.last_sold
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      LEFT JOIN (
        SELECT code, MAX(log_date) AS last_change FROM amz_price_log GROUP BY code
      ) lc ON lc.code = a.code
      LEFT JOIN (
        SELECT code, MAX(solddate) AS last_sold FROM sales WHERE channel='AMZ' AND qty>0 GROUP BY code
      ) ls ON ls.code = a.code
      WHERE sk.segment = $1
      ORDER BY lc.last_change DESC NULLS LAST, a.code
    `, [segment]);

    const rows = result.rows.map((r) => ({
      code: r.code,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
      last_change: toIsoDate(r.last_change),
      last_sold: toIsoDate(r.last_sold),
    }));

    return res.json({ return_code: 'SUCCESS', segment, rows });
  } catch (err) {
    logger.error('[amz-all] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segment list' });
  }
});

module.exports = router;
