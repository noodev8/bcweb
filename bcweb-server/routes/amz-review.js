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
UPDATE is enough — no upsert. Never writes amzfeed (READ ONLY); it only READS amzprice to record the price being held.

Since 2026-08-31 this also writes one HOLD row per SKU into amz_price_log (new_price = old_price), so a hold shows on Analytics ->
Price Changes instead of being invisible. docs/hold-logging-spec.md. Requires auth.

THE HELD PRICE IS THE CURRENT PRICE, NOT THE FEED (fixed 2026-11-01). amzfeed.amzprice is Amazon's price as of the last Update Amazon
import, so minutes after an Apply (or after an upload nobody marked) it still shows the OLD price. A hold logged at that stale price is
the newest log row for the SKU, and once the import catches up it no longer matches the feed — so the basket's no-op guard lets it
through as a real change and the next upload puts the OLD price back. It happened: 17659-23-44 was raised £50 -> £65.99 on 2 Oct, held
3 minutes later (logged at £50), the £65.99 went up without "I've uploaded", and on 5 Oct the basket uploaded the £50 hold. The held
price now comes from utils/amzNow.js → AMZ_NOW_CTES (a price logged since the last import — uploaded, or still pending in the basket
— else the feed).
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
const { writeAmzReview } = require('../utils/amzReviewWrite');   // THE W-A2 write (shared with scripts/amz-review-set.js)
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

    // Optional free-text rationale, saved onto every hold row this call writes. Mirrors W-A1's note.
    const note = typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null;

    // reviewDays is required here (unlike apply's default) and must be a positive integer — same rule as W-seg-1 / W-A1.
    const reviewDays = Number(body.reviewDays);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }

    // The write returns the review date it set as text, so the client badges "parked until <date>" with the exact server date.
    const changedBy = req.user.display_name;
    // THE write lives in utils/amzReviewWrite.js (shared with the /amz-pricing skill, 2026-11-04) — the history of its rules (hold
    // rows, held price = the CURRENT price, not the feed) stays in this header. keepLater false: the button sets the date it is given.
    const result = await withTransaction((client) => writeAmzReview(client, { codes: cleanCodes, reviewDays, note, changedBy }));

    const nextReview = result.rows[0] ? result.rows[0].next_review : null;

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount, logged: result.logged, nextReview });
  } catch (err) {
    logger.error('[amz-review] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark SKUs reviewed' });
  }
});

module.exports = router;
