/*
=======================================================================================================================================
API Route: prospect_have
=======================================================================================================================================
Method: GET
Purpose: "Do we already have it?" for the Prospects screen — search our own catalogue (every style ever set up in skusummary) by a
         model number, brand or words from the title, e.g. "Y3453" or "rieker chelsea". Returns each match with whether any size is in
         stock right now. Deliberately nothing more — no sales, no prices, no links to the pricing screens (owner, 2026-10-21: this is
         mining for NEW products; managing existing stock is another process). READ ONLY. Requires auth.

         Every word must match somewhere in groupid, title or brand (AND of ILIKEs), so "rieker chelsea" finds Rieker Chelsea boots,
         not every Rieker plus every Chelsea. Up to 25 matches.
=======================================================================================================================================
Request Query Params:
  term (string, required)

Success Response:
{ "return_code": "SUCCESS",
  "results": [ { "groupid": "RIE-Y3453-BLACK", "title": "Rieker Y3453 Ankle Boot", "brand": "Rieker", "in_stock": true } ],
  "truncated": false }
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
const logger = require('../utils/logger');

router.use(verifyToken);

const LIMIT = 25;

router.get('/', async (req, res) => {
  try {
    const words = String(req.query.term || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (words.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }
    // One %word% parameter per word; each must hit groupid, title or brand. The %..% is built here and bound, never interpolated.
    const params = words.map((w) => `%${w}%`);
    const where = params
      .map((_, i) => `(ss.groupid ILIKE $${i + 1} OR t.shopifytitle ILIKE $${i + 1} OR ss.brand ILIKE $${i + 1})`)
      .join(' AND ');

    // Sellable stock = localstock #FREE, not deleted, qty > 0 (CLAUDE.md — never skusummary.stockvariants).
    const result = await query(`
      SELECT ss.groupid, t.shopifytitle, NULLIF(TRIM(ss.brand), '') AS brand,
             EXISTS (SELECT 1 FROM localstock ls
                      WHERE ls.groupid = ss.groupid AND ls.ordernum = '#FREE' AND COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0) AS in_stock
        FROM skusummary ss
        LEFT JOIN title t ON t.groupid = ss.groupid
       WHERE ${where}
       ORDER BY ss.groupid
       LIMIT ${LIMIT + 1}
    `, params);

    const truncated = result.rows.length > LIMIT;
    const results = result.rows.slice(0, LIMIT).map((r) => ({
      groupid: r.groupid, title: r.shopifytitle || null, brand: r.brand, in_stock: r.in_stock,
    }));
    return res.json({ return_code: 'SUCCESS', results, truncated });
  } catch (err) {
    logger.error('[prospect-have] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
