/*
=======================================================================================================================================
API Route: pricing_park_bulk
=======================================================================================================================================
Method: POST
Purpose: The Shopify batch "no change — just set review" write (bulk W2) — park a whole SELECTION of styles at once, for styles the
         operator looked at on the Winners/Losers list and decided to LEAVE UNCHANGED (no price applied). It is the bulk companion to
         the single-style POST /pricing-park (W2), and the Shopify mirror of Amazon's batch POST /amz-review.

         Like W2, it ONLY stamps the review cooldown (next_shopify_price_review). No price change, so:
           - shopifychange is NOT touched (nothing for the nightly Shopify sync to push).
           - NO price_change_log rows are written (there was no price change to audit).
         A future review date hides each style from the Winners/Losers triage until the cooldown passes (CLAUDE.md review cooldown).

         Batch by design: an operator triaging a segment often wants to defer several obvious "leave it" styles in one go without opening
         each drill. There is NO "None" here — this write's whole job is to set a review date; to leave styles alone the operator simply
         doesn't select them. A price change in bulk goes through the client's per-style loop over POST /pricing-apply (W1) instead, so
         the live Shopify + Google pushes still run exactly as for a single apply.

Run through withTransaction for consistency with W1/W2 even though it's a single set-based statement.
=======================================================================================================================================
Request Payload:
{
  "groupids":  ["ABC123", "DEF456"],  // array of style ids, required, non-empty, <= 500
  "reviewDays": 30                     // integer, required, >= 1
}

Success Response:
{
  "return_code": "SUCCESS",
  "updated": 2,                 // rows actually parked (styles that existed)
  "next_review": "2026-08-12"   // CURRENT_DATE + reviewDays (the date set), null if nothing matched
}
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

// Cap the batch size so a runaway/malformed request can't park thousands of styles in one call (mirrors amz-review's MAX_CODES).
const MAX_IDS = 500;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { groupids } = body;

    // groupids must be a non-empty array of non-empty strings, within the cap. Normalise + dedupe defensively.
    if (!Array.isArray(groupids) || groupids.length === 0 || groupids.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupids must be a non-empty array of at most ${MAX_IDS} style ids` });
    }
    const cleanIds = Array.from(new Set(
      groupids.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids must contain at least one valid style id' });
    }

    // reviewDays is required here (a park is a review decision) and must be a positive integer — same rule as W2 / W-A2.
    const reviewDays = Number(body.reviewDays);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }

    // One parameterised set-based UPDATE (no string interpolation of the array), RETURNING the review date it set so the client can
    // badge the exact server date (avoids a JS-side UTC/BST day-shift — same care as pricing-park / amz-review).
    const result = await withTransaction((client) =>
      client.query(
        `UPDATE skusummary SET next_shopify_price_review = CURRENT_DATE + $2::int
         WHERE groupid = ANY($1::text[])
         RETURNING to_char(next_shopify_price_review, 'YYYY-MM-DD') AS next_review`,
        [cleanIds, reviewDays]
      )
    );

    const nextReview = result.rows[0] ? result.rows[0].next_review : null;

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount, next_review: nextReview });
  } catch (err) {
    logger.error('[pricing-park-bulk] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set reviews' });
  }
});

module.exports = router;
