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
const { safeNumeric } = require('../utils/sql');
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

    // 3) W2 UPDATE (CLAUDE.md) — set the cooldown, and RETURN the price being held. Reading the price in the SAME statement that
    //    stamps the review date is deliberate: fetching it separately would let the logged old_price drift from what was actually
    //    held if anything moved between the two reads. safeNumeric because shopifyprice is a legacy VARCHAR that can hold junk.
    const changedBy = req.user.display_name;
    const result = await withTransaction(async (client) => {
      const upd = await client.query(`
        UPDATE skusummary
           SET next_shopify_price_review = CURRENT_DATE + $2::int
         WHERE groupid = $1
         RETURNING next_shopify_price_review, ${safeNumeric('shopifyprice')} AS held_price
      `, [groupid, reviewDays]);

      if (upd.rows.length === 0) return upd;

      // 4) The HOLD audit row: new_price = old_price is what makes it a hold rather than a move.
      //
      //    google_pushed_at is PRE-STAMPED to now(). scripts/google-price-sweep.js pushes every SHP row it finds with a NULL
      //    stamp, so an un-stamped hold would hand it a queue of no-op pushes — harmless in effect (it would push the price that
      //    is already live) but wasteful and confusing. A hold has nothing to send, so it is born sent. The sweep also carries its
      //    own old_price <> new_price guard as the safety net; this stamp means the fix does not depend on that script being
      //    redeployed. See docs/hold-logging-spec.md §4.
      //
      //    NULL held_price => NO log row, while the review date still stands. A hold on a price we cannot read is not a decision
      //    that can be scored, and safeNumeric returning NULL must never be written as a £0.00 hold.
      const heldPrice = upd.rows[0].held_price;
      if (heldPrice !== null) {
        await client.query(`
          INSERT INTO price_change_log
             (groupid, channel, old_price, new_price, reason_code, reason_notes, changed_by, google_pushed_at)
          VALUES ($1, 'SHP', $2, $2, NULL, $3, $4, now())
        `, [groupid, heldPrice, note, changedBy]);
      }
      return upd;
    });

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const logged = result.rows[0].held_price !== null;
    const nr = result.rows[0].next_shopify_price_review;
    const d = nr instanceof Date ? nr : new Date(nr);
    const nextReviewIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return res.json({ return_code: 'SUCCESS', groupid, next_review: nextReviewIso, logged });
  } catch (err) {
    logger.error('[pricing-park] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set review' });
  }
});

module.exports = router;
