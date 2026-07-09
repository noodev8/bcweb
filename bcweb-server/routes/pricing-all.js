/*
=======================================================================================================================================
API Route: pricing_all
=======================================================================================================================================
Method: GET
Purpose: The "ALL" list for a segment — every style in it, unfiltered. Unlike WINNERS (pricing-triage) and LOSERS (pricing-losers),
         which each apply a job-specific filter (in stock, un-parked, recent sales, etc.), this returns the WHOLE segment: parked styles,
         out-of-stock styles, dead styles — everything. It's a browse/lookup view, added because the operator sometimes needs to find a
         style again (e.g. "which groupid did I just change?") without remembering which of the two job-lists it falls in.

         To serve that exact need, rows are ordered by **most-recently price-changed first** (MAX(price_change_log.change_date) for the
         SHP channel), NULLS LAST, then groupid — so a style you just applied a price to sits at the top. Each row carries the current
         price, live stock, the last-change date, and the review/park date, so the list doubles as an at-a-glance segment overview.

         Schema landmines respected (CLAUDE.md): shopifyprice is legacy VARCHAR -> safeNumeric (NULL on junk). Live stock from localstock
         (#FREE, not deleted, qty>0), never stockvariants. Human name from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params:
  segment (string, required)

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "Arizona",
  "rows": [
    { "groupid": "0151181-ARIZONA", "title": "Arizona Birko-Flor", "price": 39.95, "stock": 8,
      "last_change": "2026-07-08", "next_review": "2026-07-15" },
    ... // most-recently-changed first, then groupid; last_change/next_review null when none
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

    // Every style in the segment. Stock and last-change are pre-aggregated in subqueries (so neither fans out the row set), then
    // LEFT JOINed — a style with no stock rows / no logged change simply shows 0 / NULL. Ordered recently-changed first.
    const result = await query(`
      SELECT
        ss.groupid,
        t.shopifytitle                     AS title,
        ${safeNumeric('ss.shopifyprice')}  AS price,
        ss.next_shopify_price_review,
        COALESCE(st.stock, 0)              AS stock,
        lc.last_change
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      LEFT JOIN (
        SELECT groupid, SUM(qty) AS stock FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ) st ON st.groupid = ss.groupid
      LEFT JOIN (
        SELECT groupid, MAX(change_date) AS last_change FROM price_change_log
        WHERE channel='SHP'
        GROUP BY groupid
      ) lc ON lc.groupid = ss.groupid
      WHERE ss.segment = $1
      ORDER BY lc.last_change DESC NULLS LAST, ss.groupid
    `, [segment]);

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title || null,
      price: num(r.price),
      stock: Number(r.stock),
      last_change: toIsoDate(r.last_change),
      next_review: toIsoDate(r.next_shopify_price_review)
    }));

    return res.json({ return_code: 'SUCCESS', segment, rows });
  } catch (err) {
    logger.error('[pricing-all] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segment list' });
  }
});

module.exports = router;
