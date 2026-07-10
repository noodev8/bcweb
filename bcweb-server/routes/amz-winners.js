/*
=======================================================================================================================================
API Route: amz_winners
=======================================================================================================================================
Method: GET
Purpose: Stage 1 — the WINNERS shortlist for a segment (the Amazon mirror of Shopify's pricing-triage). For a chosen segment, returns the
         top N in-stock Amazon SKUs by units sold in the last `days`, on the Amazon channel. These are the strong, well-stocked sizes to
         price UP / harvest (docs/amz-pricing-spec.md §1). SKU-grain: Amazon prices per size, so this is one row PER SKU, not per groupid —
         a groupid's fast sizes can be WINNERS while its dead sizes are LOSERS.

Key domain rules baked into the SQL:
  - Amazon only (channel='AMZ'); positive sales only (qty>0, soldprice>0).
  - In FBA stock only: amzfeed.amzlive > 0 (nothing to harvest on a size with no sellable FBA stock right now). Unlike Shopify's
    "can't restock" rule this is just "in stock now"; inbound is shown as context on the drill, not a filter.
  - There is NO park / review-cooldown concept on Amazon (docs/amz-pricing-spec.md §4) — so, unlike Shopify triage, nothing is hidden
    for a cooldown. The list is simply the current top sellers.
  - Window `days` defaults to 30 (docs/amz-pricing-spec.md — Amazon-native windows). 7d units are carried as a secondary signal/tiebreak.

Schema landmines respected: amzfeed is FBA-only, READ ONLY. amzprice is a junk-prone VARCHAR -> read via safeNumeric. amzlive is a real
integer. Size = RIGHT(code,2). Human name from title.shopifytitle (not the overloaded colour tag). Requires auth.
=======================================================================================================================================
Request Query Params:
  segment  (string, required)  - the segment to shortlist within
  days     (int, optional)     - lookback window in days for sales; default 30
  limit    (int, optional)     - shortlist size; default 10

Success Response:
{
  "return_code": "SUCCESS",
  "segment": "IVES-WHITE",
  "days": 30,
  "rows": [
    { "rank": 1, "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "groupid": "FLE030-IVES-WHITE",
      "size": "38", "title": "...", "price": 37.99, "fba": 96, "u7": 4, "units": 19, "last_sold": "2026-07-08" },
    ...   // ordered by units (in window) desc; rank is the 1-based row number
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

router.get('/', async (req, res) => {
  try {
    const { segment } = req.query;
    // Defaults: 30-day window, top 10. Parse defensively; fall back on anything non-numeric.
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 30;
    const limit = Number.parseInt(req.query.limit, 10) > 0 ? Number.parseInt(req.query.limit, 10) : 10;

    if (!segment) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'segment is required' });
    }

    // $1 segment, $2 days, $3 limit.
    // win: units in the window + last-sold per SKU. s7: 7-day units (secondary signal + tiebreak). The INNER JOIN to `win` drops SKUs
    // with no sales in the window; the amzlive>0 filter drops out-of-stock SKUs; LIMIT tops the shortlist back up to N.
    const result = await query(`
      WITH win AS (
        SELECT code, SUM(qty) AS units, MAX(solddate) AS last_sold
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - $2::int
        GROUP BY code
      ),
      s7 AS (
        SELECT code, SUM(qty) AS u7
        FROM sales
        WHERE channel='AMZ' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 7
        GROUP BY code
      )
      SELECT a.code, a.groupid, a.sku AS amz_sku, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba,
             w.units,
             COALESCE(s7.u7,0) AS u7,
             to_char(w.last_sold,'YYYY-MM-DD') AS last_sold
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN win w ON w.code = a.code                       -- INNER JOIN: must have sold in the window
      LEFT JOIN s7 ON s7.code = a.code
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE sk.segment = $1
        AND COALESCE(a.amzlive,0) > 0                     -- in FBA stock now
      ORDER BY w.units DESC, COALESCE(s7.u7,0) DESC, w.last_sold DESC
      LIMIT $3::int
    `, [segment, days, limit]);

    const rows = result.rows.map((r, i) => ({
      rank: i + 1,
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
      u7: Number(r.u7),
      units: Number(r.units),
      last_sold: r.last_sold || null,
    }));

    return res.json({ return_code: 'SUCCESS', segment, days, rows });
  } catch (err) {
    logger.error('[amz-winners] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load winners list' });
  }
});

module.exports = router;
