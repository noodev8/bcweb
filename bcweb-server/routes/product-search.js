/*
=======================================================================================================================================
API Route: product_search
=======================================================================================================================================
Method: GET
Purpose: Stage 1 of the Add / Modify Product module. Searches the master product list by GROUPID (skusummary.groupid) so the user can
         find an existing product to edit. If nothing matches, that empty result is the cue to CREATE a new groupid (creation itself is
         a later stage — this endpoint is read-only search).

         Deliberately narrow: the search field is the groupid ONLY (per owner: "the search is just for a GROUPID in skusummary table").
         We LEFT JOIN `title` purely to show a human-readable name alongside each groupid in the results list — the match is still on
         groupid alone. Results are returned in groupid sort order (the legacy PowerBuilder screen lists them ascending). Requires auth.
=======================================================================================================================================
Request Query Params:
  term (string, required) - free text; matched with ILIKE %term% against skusummary.groupid

Success Response:
{
  "return_code": "SUCCESS",
  "limited": false,                 // true when more than MAX matches exist and the list was trimmed (nudge user to refine)
  "results": [
    { "groupid": "0128201-GIZEH", "title": "Birkenstock Gizeh EVA Sandals White Regular Fit" },
    { "groupid": "0128221-GIZEH", "title": "Birkenstock Gizeh EVA Sandals White Narrow Fit" }
    // ... up to MAX (25), ordered by groupid ascending
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
const logger = require('../utils/logger');

// All Add / Modify routes require a logged-in user.
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // The single search field: a groupid fragment. Trim so stray spaces don't defeat the match.
    const term = (req.query.term || '').trim();
    if (!term) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'term is required' });
    }

    // $1 = %term%. The %..% wrapper is built here and passed as a BOUND parameter (never interpolated into the SQL string),
    // so the search stays injection-safe (CLAUDE.md / API-RULES: parameterised queries only).
    // Match on groupid alone; title is only joined for display. ORDER BY groupid = the "sort order" the legacy screen shows.
    // Cap the result set (MAX): the workflow is "search a model like IVES, then narrow by colour", so a big dump is never useful
    // and usually means the search was too vague. We fetch MAX+1 rows so we can tell the caller whether there were MORE than we
    // returned (the n+1 trick) — the page then nudges the user to refine rather than silently hiding matches.
    const MAX = 25;
    const like = `%${term}%`;
    const result = await query(`
      SELECT ss.groupid, t.shopifytitle
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid ILIKE $1
      ORDER BY ss.groupid
      LIMIT $2
    `, [like, MAX + 1]);

    // If we got MAX+1 back there are more matches than we're showing -> flag as limited and trim to MAX.
    const limited = result.rows.length > MAX;
    const results = result.rows.slice(0, MAX).map((r) => ({
      groupid: r.groupid,
      title: r.shopifytitle || null
    }));

    return res.json({ return_code: 'SUCCESS', results, limited });
  } catch (err) {
    logger.error('[product-search] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
