/*
=======================================================================================================================================
API Route: pricing_park
=======================================================================================================================================
Method: POST
Purpose: Stage 3 write W2 (CLAUDE.md) — "no change, just set review". The user doesn't want to change the price but wants to stop the
         style re-surfacing in the triage, so we only stamp the cooldown (next_shopify_price_review). No price change, so:
           - shopifychange is NOT touched (nothing for the nightly Shopify sync to push).
           - NO price_change_log row is written (there was no price change to audit).
         Run through withTransaction for consistency with W1 even though it's a single statement.
=======================================================================================================================================
Request Payload:
{
  "groupid":    "ABC123",  // string, required
  "reviewDays": 30         // integer, required, >= 1
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "next_review": "2026-08-03"   // CURRENT_DATE + reviewDays
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_REVIEW_DAYS"
"NOT_FOUND"
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

router.post('/', async (req, res) => {
  try {
    const { groupid } = req.body || {};
    const reviewDaysRaw = req.body ? req.body.reviewDays : undefined;

    // 1) Presence.
    if (!groupid || reviewDaysRaw === undefined || reviewDaysRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and reviewDays are required' });
    }

    // 2) Validate review period: integer >= 1 (a park is still a review decision).
    const reviewDays = Number(reviewDaysRaw);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }

    // 3) W2 UPDATE (CLAUDE.md) — set only the cooldown. RETURNING lets us both confirm the row existed and read back the date.
    const result = await withTransaction(async (client) => {
      return client.query(`
        UPDATE skusummary
           SET next_shopify_price_review = CURRENT_DATE + $2::int
         WHERE groupid = $1
         RETURNING next_shopify_price_review
      `, [groupid, reviewDays]);
    });

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const nr = result.rows[0].next_shopify_price_review;
    const d = nr instanceof Date ? nr : new Date(nr);
    const nextReviewIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return res.json({ return_code: 'SUCCESS', groupid, next_review: nextReviewIso });
  } catch (err) {
    logger.error('[pricing-park] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set review' });
  }
});

module.exports = router;
