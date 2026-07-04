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

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const term = (req.query.term || '').trim();
    if (!term) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }

    // S6 (CLAUDE.md) — verbatim. $1 = %term%. ILIKE on both groupid and title; prices cast from varchar.
    // The %..% is built here (not interpolated into SQL) and passed as a bound parameter, so it stays injection-safe (CLAUDE.md).
    const like = `%${term}%`;
    const result = await query(`
      SELECT ss.groupid, t.shopifytitle, ss.segment, ${safeNumeric('ss.shopifyprice')} AS now
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid ILIKE $1 OR t.shopifytitle ILIKE $1
      ORDER BY ss.groupid LIMIT 25
    `, [like]);

    const results = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.shopifytitle || null,
      segment: r.segment || null,
      now: r.now === null ? null : Number(r.now)
    }));

    return res.json({ return_code: 'SUCCESS', results });
  } catch (err) {
    console.error('[pricing-find] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
