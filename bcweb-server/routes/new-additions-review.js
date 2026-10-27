/*
=======================================================================================================================================
API Route: new_additions_review
=======================================================================================================================================
Method: POST
Purpose: Review a NEW style on Reports → New Additions (owner, 2026-10-27: "add a review and due date to them as well ... these are
         products that need actions and easily inspected"). Stamps skusummary.next_new_review = today + reviewDays for one or more
         styles, which hides them from the screen's Due view (and Daily's New stuff count) until then — the same shape as AMZ loaded's
         POST /amz-loaded-review, on its own column so it never touches a price or AMZ-loaded review.
         reviewDays = 0 CLEARS the date — the style goes back to its default due date, created + 20 days (utils/processMap.js).

         Writes nothing else: no price, no log row (it is a to-do marker, not a pricing decision). Set-based, one statement.

Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupids":   ["ABC123", "DEF456"],  // required, non-empty, <= 500
  "reviewDays": 30                     // required integer >= 0 (0 = clear)
}

Success Response:
{ "return_code": "SUCCESS", "updated": 2, "next_review": "2026-11-25" }   // next_review null when cleared or nothing matched
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_REVIEW_DAYS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_IDS = 500;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { groupids } = body;
    if (!Array.isArray(groupids) || groupids.length === 0 || groupids.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupids must be a non-empty array of at most ${MAX_IDS} style ids` });
    }
    const cleanIds = Array.from(new Set(groupids.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids must contain at least one valid style id' });
    }
    const reviewDays = Number(body.reviewDays);
    if (!Number.isInteger(reviewDays) || reviewDays < 0) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 0' });
    }

    // RETURNING the date as text so the client shows the server's exact date (no JS UTC/BST day-shift).
    const result = await withTransaction((client) => client.query(
      `UPDATE skusummary
          SET next_new_review = CASE WHEN $2::int = 0 THEN NULL ELSE CURRENT_DATE + $2::int END
        WHERE groupid = ANY($1::text[])
        RETURNING to_char(next_new_review, 'YYYY-MM-DD') AS next_review`,
      [cleanIds, reviewDays]
    ));

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount, next_review: result.rows[0] ? result.rows[0].next_review : null });
  } catch (err) {
    logger.error('[new-additions-review] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set the review' });
  }
});

module.exports = router;
