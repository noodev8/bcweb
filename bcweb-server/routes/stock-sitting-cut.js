/*
=======================================================================================================================================
API Route: stock_sitting_cut
=======================================================================================================================================
Method: POST
Purpose: Reports → Selling vs Sitting — CUT styles from the sitting list's working set, or RELEASE them back (owner, 2026-10-11: "can I
         cut some items from the rows so that I update collection and price to a set few?").

         A cut style is STILL SITTING: it stays on the list (greyed, in a Cut section) and in the Sitting box. What changes is that the
         ACTIONS skip it — "Update collection" (the Shopify `clearance` tag, utils/clearanceTag.js), "Reprice" (routes/
         pricing-sitting-list.js) and the Google Ads Sitting chip. The membership rule itself (utils/stockSitting.js) is untouched.

         Saved team-wide until released — no expiry (migrations/20261011_sitting_cut.sql has the why). Stamps skusummary.sitting_cut_at
         / sitting_cut_by on cut, clears both on release. Cutting an already-cut style keeps its original stamp.

         This route does NOT touch Shopify. A cut style that already carries the tag comes off at the next "Update collection".

         One set-based UPDATE (capped at 500 ids), so no transaction or loop is needed.
=======================================================================================================================================
Request Payload:
{
  "groupids": ["1017722-BEND", "..."],  // array of style ids, required, non-empty, <= 500
  "cut": true                           // boolean, required: true = cut, false = release
}

Success Response:
{
  "return_code": "SUCCESS",
  "updated": 2                          // styles whose mark actually changed
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

router.use(verifyToken);

const MAX_IDS = 500;   // same cap as pricing-park-bulk / amz-review

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { groupids, cut } = body;

    if (!Array.isArray(groupids) || groupids.length === 0 || groupids.length > MAX_IDS || typeof cut !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupids (1-${MAX_IDS} style ids) and cut (true/false) are required` });
    }
    const cleanIds = Array.from(new Set(
      groupids.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids must contain at least one valid style id' });
    }

    // Only rows whose state changes are touched, so `updated` means something and a re-cut keeps its first stamp.
    const r = cut
      ? await query(
          `UPDATE skusummary SET sitting_cut_at = now(), sitting_cut_by = $2
           WHERE groupid = ANY($1::text[]) AND sitting_cut_at IS NULL`,
          [cleanIds, req.user.display_name]
        )
      : await query(
          `UPDATE skusummary SET sitting_cut_at = NULL, sitting_cut_by = NULL
           WHERE groupid = ANY($1::text[]) AND sitting_cut_at IS NOT NULL`,
          [cleanIds]
        );

    return res.json({ return_code: 'SUCCESS', updated: r.rowCount });
  } catch (err) {
    logger.error('[stock-sitting-cut] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update the cut' });
  }
});

module.exports = router;
