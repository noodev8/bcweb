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
price now comes from utils/slider.js → AMZ_NOW_CTES (a price logged since the last import — uploaded, or still pending in the basket
— else the feed), the same "what is Amazon's price now" the Pricing Slider already relies on; that also stops a stale hold reading as
"priced by hand" to a slider (offTrack).
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
const { safeNumeric } = require('../utils/sql');
const { AMZ_NOW_CTES } = require('../utils/slider');   // each SKU's current price: a newer logged price, else the feed (header)
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

    // One parameterised set-based UPDATE (no string interpolation of the array), RETURNING the review date it set so the client can
    // badge "parked until <date>" with the exact server date (avoids a JS-side UTC/BST day-shift — same care as utils/segmentDue.isoDate).
    const changedBy = req.user.display_name;
    const result = await withTransaction(async (client) => {
      const upd = await client.query(
        `UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int
         WHERE code = ANY($1::text[])
         RETURNING code, to_char(next_amz_price_review, 'YYYY-MM-DD') AS next_review`,
        [cleanCodes, reviewDays]
      );

      // HOLD audit rows (2026-08-31), one per SKU reviewed — new_price = old_price is what marks them as holds rather than moves.
      // Until now an Amazon hold was recorded nowhere, so the Price Changes screen showed only moves; analytics-change-impact.js
      // already renders an equal-price row as kind 'LEVEL'. See docs/hold-logging-spec.md.
      //
      // The held price is the SKU's CURRENT price — amz_now (a price logged since the last Amazon import), else amzfeed — never the
      // feed alone, which lags an Apply or an unmarked upload and turned a hold into a price revert (header). amzfeed.amzprice is a
      // VARCHAR on a READ ONLY feed table, so it goes through safeNumeric; a bare ::numeric would throw on the first junk row. A SKU
      // with no readable price is still REVIEWED but writes no hold row: a hold on a price we cannot read is not a decision that can
      // be scored, and NULL must never be logged as a 0.00 hold. Set-based (500-code cap) rather than a loop, per the no-N+1 rule.
      //
      // No google_pushed_at here — that column is Shopify-only. A hold at the feed price is kept out of the Seller Central upload file
      // by the no-op guard in routes/amz-basket.js; a hold at a still-pending price carries that same price, so uploading it is right.
      const ins = await client.query(
        `WITH ${AMZ_NOW_CTES},
         held AS (
           SELECT a.code, COALESCE(n.price, ${safeNumeric('a.amzprice')}) AS price
             FROM amzfeed a
             LEFT JOIN amz_now n ON n.code = a.code
            WHERE a.code = ANY($1::text[])
         )
         INSERT INTO amz_price_log
            (log_date, code, old_price, new_price, notes, changed_by, changed_at)
         SELECT CURRENT_DATE, code, price, price, $2, $3, now()
           FROM held
          WHERE price IS NOT NULL`,
        [upd.rows.map((r) => r.code), note, changedBy]
      );

      return { rows: upd.rows, rowCount: upd.rowCount, logged: ins.rowCount };
    });

    const nextReview = result.rows[0] ? result.rows[0].next_review : null;

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount, logged: result.logged, nextReview });
  } catch (err) {
    logger.error('[amz-review] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark SKUs reviewed' });
  }
});

module.exports = router;
