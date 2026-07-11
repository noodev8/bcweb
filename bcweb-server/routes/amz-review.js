/*
=======================================================================================================================================
API Route: amz_review
=======================================================================================================================================
Method: POST
Purpose: The Amazon batch "mark reviewed" write (W-A2, docs/segments-spec.md §10.5B) — park a whole SELECTION of SKUs at once, for
         sizes the operator looked at and decided to LEAVE UNCHANGED (no price applied). This is the companion to the auto-park in
         W-A1 (POST /amz-apply): apply parks the priced SKU, this parks the reviewed-but-unchanged ones. Both simply stamp
         skumap.next_amz_price_review = CURRENT_DATE + reviewDays; the derived Amazon segment clock and the winners/losers queues
         (which filter un-parked only) consume it — parked SKUs drop out, the queue refills, the rolling worklist advances (§9.2).

         Batch by design: Amazon's size-grain volume makes one-at-a-time parking tedious, so the operator selects N SKUs and marks the
         whole set reviewed in one call. There is NO "None" — this write's whole job is to set a review date; to leave SKUs alone the
         operator simply doesn't select them.

Schema note: skumap.next_amz_price_review is a plain DATE column (added 2026-07-11, §10.2), the Amazon analogue of
skusummary.next_shopify_price_review. The skumap row always exists for a real SKU (code is unique in skumap), so a plain set-based
UPDATE is enough — no upsert. Never writes amzfeed (READ ONLY). Requires auth.
=======================================================================================================================================
Request Payload:
{ "codes": ["FLE030-IVES-WHITE-38", "FLE030-IVES-WHITE-39"], "reviewDays": 14 }

Success Response:
{ "return_code": "SUCCESS", "updated": 2, "nextReview": "2026-07-25" }   // updated = rows actually parked; nextReview = the date set
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "INVALID_REVIEW_DAYS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Cap the batch size so a runaway/malformed request can't park thousands of SKUs in one call (§10.5B: "≤ 500 per call").
const MAX_CODES = 500;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { codes } = body;

    // codes must be a non-empty array of non-empty strings, within the cap. Normalise + dedupe defensively.
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > MAX_CODES) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `codes must be a non-empty array of at most ${MAX_CODES} SKU codes` });
    }
    const cleanCodes = Array.from(new Set(
      codes.filter((c) => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
    ));
    if (cleanCodes.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'codes must contain at least one valid SKU code' });
    }

    // reviewDays is required here (unlike apply's default) and must be a positive integer — same rule as W-seg-1 / W-A1.
    const reviewDays = Number(body.reviewDays);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }

    // One parameterised set-based UPDATE (no string interpolation of the array), RETURNING the review date it set so the client can
    // badge "parked until <date>" with the exact server date (avoids a JS-side UTC/BST day-shift — same care as utils/segmentDue.isoDate).
    const result = await withTransaction((client) =>
      client.query(
        `UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int
         WHERE code = ANY($1::text[])
         RETURNING to_char(next_amz_price_review, 'YYYY-MM-DD') AS next_review`,
        [cleanCodes, reviewDays]
      )
    );

    const nextReview = result.rows[0] ? result.rows[0].next_review : null;

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount, nextReview });
  } catch (err) {
    logger.error('[amz-review] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark SKUs reviewed' });
  }
});

module.exports = router;
