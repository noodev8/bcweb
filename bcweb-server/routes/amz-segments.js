/*
=======================================================================================================================================
API Route: amz_segments
=======================================================================================================================================
Method: GET
Purpose: Stage-0 of the Amazon Pricing flow — the segment picker. Mirrors the Shopify /pricing-segments route (CLAUDE.md Stage 0) but
         for the Amazon/FBA channel and at SKU grain: returns the managed Amazon segments, each with a count of managed SKUs, so the web
         /amz screen can render the segment picker. Clicking a segment goes to its WINNERS | LOSERS lists.

"Managed" = a segment that has at least one live `amzfeed` row we can price (amzfeed is FBA-only, refreshed nightly from Amazon). The
count is the number of managed SKUs (one amzfeed row per size) in the segment — Amazon prices per size, so the unit here is the SKU, not
the groupid (docs/amz-pricing-spec.md §1). Segments with no amzfeed rows (Shopify-only styles) never appear.

Read-only; amzfeed is never written. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "segments": [
    { "segment": "IVES-WHITE", "skus": 7 },   // segment = skusummary.segment; skus = managed amzfeed SKUs in it
    ...
  ]                                            // ordered alphabetically by segment
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
const logger = require('../utils/logger');

// All Amazon pricing routes require a valid session (CLAUDE.md).
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // Managed segments only: those with live amzfeed rows. One amzfeed row = one priceable SKU (size). Non-empty segment names only,
    // ordered alphabetically, with a SKU count.
    const result = await query(`
      SELECT sk.segment, COUNT(*) AS skus
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      WHERE sk.segment IS NOT NULL AND sk.segment <> ''
      GROUP BY sk.segment
      ORDER BY sk.segment
    `);

    // COUNT(*) comes back as a bigint string from pg — coerce to a number for the JSON payload.
    const segments = result.rows.map((r) => ({ segment: r.segment, skus: Number(r.skus) }));

    return res.json({ return_code: 'SUCCESS', segments });
  } catch (err) {
    logger.error('[amz-segments] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Amazon segments' });
  }
});

module.exports = router;
