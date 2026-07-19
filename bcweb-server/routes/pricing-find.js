/*
=======================================================================================================================================
API Route: pricing_find
=======================================================================================================================================
Method: GET
Purpose: Direct product search (CLAUDE.md — "finding a product directly"; /pricing/find). Matches a search term against
         groupid OR the human-readable title (title.shopifytitle — NOT the overloaded colour tag, CLAUDE.md), returning up to 25 matches
         so the user can jump straight to a style's drill page without going through segment -> triage. Requires auth.
=======================================================================================================================================
Request Query Params:
  term (string, required) - free text; matched with ILIKE %term% against groupid and shopifytitle

Success Response:
{
  "return_code": "SUCCESS",
  "results": [
    { "groupid": "ABC123", "title": "Arizona Birko-Flor", "segment": "EVA-SEG", "now": 36.95 },
    ...  // up to 25, ordered by groupid
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

router.get('/', async (req, res) => {
  try {
    const term = (req.query.term || '').trim();
    if (!term) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }

    // S6 (CLAUDE.md) — $1 = %term%. ILIKE on both groupid and title; prices cast from varchar.
    // The %..% is built here (not interpolated into SQL) and passed as a bound parameter, so it stays injection-safe (CLAUDE.md).
    const like = `%${term}%`;

    // SKU-code paste helper: a full SKU code is `groupid-XX` where XX is the 2-digit EU size (size = RIGHT(code,2)
    // everywhere in the app). The Shopify flow is style-grain (groupid only), so a pasted SKU code like
    // `FLE030-IVES-WHITE-38` would never match the groupid `FLE030-IVES-WHITE` under a plain %term% ILIKE. If the term
    // ends in `-XX`, ALSO try the stripped groupid ($2). We OR it in (never replace $1) so a legitimate groupid that
    // happens to end in `-<2 digits>` still matches on its own. Null when there is no trailing size to strip.
    const sizeMatch = term.match(/^(.*)-\d{2}$/);
    const baseLike = sizeMatch ? `%${sizeMatch[1]}%` : null;

    const result = await query(`
      SELECT ss.groupid, t.shopifytitle, ss.segment, ${safeNumeric('ss.shopifyprice')} AS now
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid ILIKE $1 OR t.shopifytitle ILIKE $1
         OR ($2::text IS NOT NULL AND ss.groupid ILIKE $2)
      ORDER BY ss.groupid LIMIT 25
    `, [like, baseLike]);

    const results = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.shopifytitle || null,
      segment: r.segment || null,
      now: r.now === null ? null : Number(r.now)
    }));

    return res.json({ return_code: 'SUCCESS', results });
  } catch (err) {
    logger.error('[pricing-find] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
