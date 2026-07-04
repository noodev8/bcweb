/*
=======================================================================================================================================
API Route: pricing_segments
=======================================================================================================================================
Method: GET
Purpose: Stage-0 of the pricing flow. Returns the list of segments (skusummary.segment groupings, e.g. "EVA-SEG") with a count of
         styles in each, so the web /pricing screen can render the segment picker. A segment is the always-on starting point of the
         process (CLAUDE.md). Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "segments": [
    { "segment": "EVA-SEG", "styles": 42 },   // segment = category grouping; styles = distinct skusummary rows in it
    ...
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');

// All pricing routes require a valid session (CLAUDE.md).
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // S1 (CLAUDE.md) — verbatim. Non-empty segments only, ordered alphabetically, with a style count.
    const result = await query(`
      SELECT segment, COUNT(*) AS styles
      FROM skusummary WHERE segment IS NOT NULL AND segment <> ''
      GROUP BY segment ORDER BY segment
    `);

    // COUNT(*) comes back as a string from pg (bigint) — coerce to a number for the JSON payload.
    const segments = result.rows.map((r) => ({ segment: r.segment, styles: Number(r.styles) }));

    return res.json({ return_code: 'SUCCESS', segments });
  } catch (err) {
    console.error('[pricing-segments] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load segments' });
  }
});

module.exports = router;
