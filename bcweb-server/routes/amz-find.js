/*
=======================================================================================================================================
API Route: amz_find
=======================================================================================================================================
Method: GET
Purpose: Direct SKU search for the Amazon Pricing module (the mirror of Shopify's pricing-find; docs/amz-pricing-spec.md). Matches a search
         term against the SKU code, the groupid, OR the human-readable title (title.shopifytitle — NOT the overloaded colour tag), across
         ALL styles (segmented or not), so the operator can jump straight to a size's drill without going through segment -> list.

         SKU-grain: a groupid match returns every size under it (each is its own priceable SKU), so results can fan out — capped at 50.
         Any SKU with an amzfeed row is searchable — un-segmented styles included (their `segment` comes back null); this is a deliberate
         "jump to any SKU" escape hatch, NOT limited to styles in a managed segment. Requires auth.
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
    // NOTE: find is a "jump to ANY SKU" escape hatch — it deliberately does NOT require the style to
    // belong to a managed segment (that gate was removed per owner). Un-segmented styles (segment '') are
    // reachable too; their `segment` comes back null. skusummary is LEFT JOINed so even an amzfeed row with
    // no skusummary match still surfaces. The drill works off `code`, so an un-segmented result still drills.
    const result = await query(`
      SELECT a.code, a.sku AS amz_sku, a.groupid, NULLIF(sk.segment,'') AS segment, RIGHT(a.code,2) AS size,
             t.shopifytitle AS title,
             ${safeNumeric('a.amzprice')} AS price,
             COALESCE(a.amzlive,0) AS fba
      FROM amzfeed a
      LEFT JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t ON t.groupid = a.groupid
      WHERE a.code ILIKE $1 OR a.groupid ILIKE $1 OR t.shopifytitle ILIKE $1
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
