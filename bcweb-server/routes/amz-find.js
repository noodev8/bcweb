/*
=======================================================================================================================================
API Route: amz_find
=======================================================================================================================================
Method: GET
Purpose: Direct SKU search for the Amazon Pricing module (the mirror of Shopify's pricing-find; docs/amz-pricing-spec.md). Matches a search
         term against the SKU code, the groupid, OR the human-readable title (title.shopifytitle — NOT the overloaded colour tag), across
         ALL managed segments, so the operator can jump straight to a size's drill without going through segment -> list.

         SKU-grain: a groupid match returns every managed size under it (each is its own priceable SKU), so results can fan out — capped at
         50. Only managed SKUs (those with a live amzfeed row in a real segment) are searchable. Requires auth.
=======================================================================================================================================
Request Query Params:
  term (string, required) - free text; matched with ILIKE %term% against code, groupid and shopifytitle

Success Response:
{
  "return_code": "SUCCESS",
  "results": [
    { "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "groupid": "FLE030-IVES-WHITE", "segment": "IVES-WHITE",
      "size": "38", "title": "...", "price": 37.99, "fba": 96 },
    ...  // up to 50, ordered by groupid then code
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
    const term = (req.query.term || '').trim();
    if (!term) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }

    // The %..% is built here (not interpolated into SQL) and passed as a bound parameter, so it stays injection-safe (CLAUDE.md).
    const like = `%${term}%`;
    const result = await query(`
      SELECT a.code, a.sku AS amz_sku, a.groupid, sk.segment, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE sk.segment IS NOT NULL AND sk.segment <> ''
        AND (a.code ILIKE $1 OR a.groupid ILIKE $1 OR t.shopifytitle ILIKE $1)
      ORDER BY a.groupid, a.code
      LIMIT 50
    `, [like]);

    const results = result.rows.map((r) => ({
      code: r.code,
      amz_sku: r.amz_sku,
      groupid: r.groupid,
      segment: r.segment || null,
      size: r.size,
      title: r.title || null,
      price: num(r.price),
      fba: Number(r.fba),
    }));

    return res.json({ return_code: 'SUCCESS', results });
  } catch (err) {
    logger.error('[amz-find] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
