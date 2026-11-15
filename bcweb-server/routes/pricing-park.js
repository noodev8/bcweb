/*
=======================================================================================================================================
API Route: pricing_park
=======================================================================================================================================
Method: POST
Purpose: Stage 3 write W2 (CLAUDE.md) — "no change, just set review". The user doesn't want to change the price but wants to stop the
         style re-surfacing in the triage, so we only stamp the cooldown (next_shopify_price_review). No price change, so:
           - shopifychange is NOT touched (nothing for the nightly Shopify sync to push).
           - A price_change_log row IS written, with new_price = old_price (2026-08-31). A hold is a real pricing decision — "this
             price is right, leave it, look again in N days" — and until now it was recorded nowhere, so the Price Changes screen
             showed only moves and implied every decision was a price change. analytics-change-impact.js already classifies an
             equal-price row as kind 'LEVEL' and renders it as HOLDS without settle-gating it ("a hold isn't waiting on an
             outcome"); that plumbing existed and had never been fed. See docs/hold-logging-spec.md.
         Run through withTransaction so the review stamp and its audit row land together or not at all.
=======================================================================================================================================
Request Payload:
{
  "groupid":    "ABC123",  // string, required
  "reviewDays": 30,        // integer, required, >= 1
  "note":       "holding"  // string, optional — free-text rationale, saved to the hold's log row
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "next_review": "2026-08-03",  // CURRENT_DATE + reviewDays
  "logged": true                // false when shopifyprice was unreadable — review stamped, hold not scoreable (see below)
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
const { parkShopifyStyle } = require('../utils/priceWrite');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const { groupid } = req.body || {};
    // Optional free-text rationale, mirroring W1's note. Trimmed to NULL when blank so the log doesn't collect empty strings.
    const note = req.body && typeof req.body.note === 'string' && req.body.note.trim() !== '' ? req.body.note.trim() : null;
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

    // 3) W2 (CLAUDE.md) — set the cooldown and log the hold.
    const changedBy = req.user.display_name;
    // The W2 write itself is utils/priceWrite.js → parkShopifyStyle (one home since 2026-11-15 — the overstock cards park with it
    // too): the review date and the HOLD audit row (new_price = old_price, born Google-sent; none when the price can't be read).
    const result = await withTransaction((client) => parkShopifyStyle(client, { groupid, reviewDays, note, changedBy }));
    if (result.error) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const logged = result.logged;
    const nr = result.nextReview;
    const d = nr instanceof Date ? nr : new Date(nr);
    const nextReviewIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return res.json({ return_code: 'SUCCESS', groupid, next_review: nextReviewIso, logged });
  } catch (err) {
    logger.error('[pricing-park] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set review' });
  }
});

module.exports = router;
