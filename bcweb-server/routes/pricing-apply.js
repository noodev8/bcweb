/*
=======================================================================================================================================
API Route: pricing_apply
=======================================================================================================================================
Method: POST
Purpose: Stage 3 write W1 (CLAUDE.md) — apply a new Shopify price to a style AND stamp the review cooldown, atomically, then record an
         audit row. This is the core write of the module.

Hard rules enforced here (CLAUDE.md — do not relax):
  - A review period is REQUIRED. Reject if reviewDays is missing or < 1 (no silent default — the user picks it, CLAUDE.md).
  - Server-side bounds (never trust the client, which also enforces them for UX):
        BLOCK    newPrice < cost           -> PRICE_BELOW_COST
        BLOCK    newPrice < minshopifyprice -> PRICE_BELOW_MIN
        ALLOW+FLAG newPrice > maxshopifyprice  (returned in `warnings`)
        ALLOW+FLAG newPrice > rrp              (returned in `warnings`)
    (A bound that is NULL/blank in the DB is simply not checked.)
  - Money: round to 2dp before writing; shopifyprice is VARCHAR so write it as a 2dp STRING (e.g. '36.95') (CLAUDE.md).
  - shopifychange = 1 is set on the row — this is what the external nightly Shopify sync consumes; never skip it (CLAUDE.md).
  - changed_by = req.user.display_name, resolved by verifyToken from the token's id — NEVER sent by the client (CLAUDE.md).
  - The UPDATE + INSERT run inside withTransaction so they both land or neither does (audit can't drift from the price).
=======================================================================================================================================
Request Payload:
{
  "groupid":    "ABC123",  // string, required
  "newPrice":   37.95,     // number, required, > 0 (rounded to 2dp server-side)
  "reviewDays": 7          // integer, required, >= 1
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "new_price": "37.95",            // the 2dp string actually written
  "old_price": 36.95,             // previous numeric price (null if none)
  "next_review": "2026-07-11",    // CURRENT_DATE + reviewDays
  "warnings": ["ABOVE_MAX"]        // any non-blocking flags (ABOVE_MAX / ABOVE_RRP); [] if none
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_PRICE"
"INVALID_REVIEW_DAYS"
"PRICE_BELOW_COST"
"PRICE_BELOW_MIN"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.post('/', async (req, res) => {
  try {
    const { groupid } = req.body || {};
    const newPriceRaw = req.body ? req.body.newPrice : undefined;
    const reviewDaysRaw = req.body ? req.body.reviewDays : undefined;

    // 1) Presence.
    if (!groupid || newPriceRaw === undefined || newPriceRaw === null || reviewDaysRaw === undefined || reviewDaysRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid, newPrice and reviewDays are required' });
    }

    // 2) Validate price: a positive, finite number. Round to 2dp (CLAUDE.md) and format as the string we will store.
    const newPriceNum = Number(newPriceRaw);
    if (!Number.isFinite(newPriceNum) || newPriceNum <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'newPrice must be a positive number' });
    }
    const roundedPrice = Math.round(newPriceNum * 100) / 100;
    const priceString = roundedPrice.toFixed(2); // e.g. '37.95' — written to the varchar column

    // 3) Validate review period: integer >= 1. REQUIRED for a price change (CLAUDE.md W1).
    const reviewDays = Number(reviewDaysRaw);
    if (!Number.isInteger(reviewDays) || reviewDays < 1) {
      return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
    }

    // 4) Load the current row for bounds + the old price for the audit log. Prices are legacy VARCHARs that can hold junk, so cast
    //    with safeNumeric (NULL on non-numeric). A bound that reads back NULL is simply not enforced (can't check what we can't read).
    const cur = await query(`
      SELECT ${safeNumeric('shopifyprice')}    AS now,
             ${safeNumeric('cost')}            AS cost,
             ${safeNumeric('minshopifyprice')} AS minp,
             ${safeNumeric('maxshopifyprice')} AS maxp,
             ${safeNumeric('rrp')}             AS rrp
      FROM skusummary WHERE groupid = $1
    `, [groupid]);

    if (cur.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const row = cur.rows[0];
    const oldPrice = num(row.now);
    const cost = num(row.cost);
    const minp = num(row.minp);
    const maxp = num(row.maxp);
    const rrp = num(row.rrp);

    // 5) BLOCKING bounds (only checked when the bound exists). Enforced here regardless of the client (CLAUDE.md).
    if (cost !== null && roundedPrice < cost) {
      return res.json({ return_code: 'PRICE_BELOW_COST', message: `Price ${priceString} is below cost ${cost.toFixed(2)}` });
    }
    if (minp !== null && roundedPrice < minp) {
      return res.json({ return_code: 'PRICE_BELOW_MIN', message: `Price ${priceString} is below the minimum ${minp.toFixed(2)}` });
    }

    // 6) NON-blocking flags — allowed but surfaced so the UI can warn (CLAUDE.md).
    const warnings = [];
    if (maxp !== null && roundedPrice > maxp) warnings.push('ABOVE_MAX');
    if (rrp !== null && roundedPrice > rrp) warnings.push('ABOVE_RRP');

    const changedBy = req.user.display_name; // resolved server-side from the token — never from the client body

    // 7) Atomic write (W1, CLAUDE.md) — UPDATE skusummary + INSERT price_change_log in one transaction.
    const nextReview = await withTransaction(async (client) => {
      // W1 UPDATE — verbatim shape. shopifyprice as string ($2); shopifychange=1 for the nightly sync; cooldown = today + reviewDays.
      const upd = await client.query(`
        UPDATE skusummary
           SET shopifyprice = $2,
               shopifychange = 1,
               next_shopify_price_review = CURRENT_DATE + $3::int
         WHERE groupid = $1
         RETURNING next_shopify_price_review
      `, [groupid, priceString, reviewDays]);

      // W1 INSERT — audit row. Columns/values per CLAUDE.md W1: (groupid, 'SHP', old_price, new_price, NULL, '', changed_by).
      // NOTE: CLAUDE.md's W1 numbers these $4/$5/$6 as if one shared 6-param statement. Here the UPDATE and INSERT are
      // separate parameterised queries, so the INSERT gets its own $1..$4 — passing unused params ($2/$3) makes Postgres reject the
      // query ("could not determine data type of parameter $2"). reason_code NULL and reason_notes '' by design (CLAUDE.md). change_date
      // defaults to today.
      await client.query(`
        INSERT INTO price_change_log
           (groupid, channel, old_price, new_price, reason_code, reason_notes, changed_by)
        VALUES ($1, 'SHP', $2, $3, NULL, '', $4)
      `, [groupid, oldPrice, roundedPrice, changedBy]);

      return upd.rows[0].next_shopify_price_review;
    });

    // Format the returned cooldown date as YYYY-MM-DD (local components to avoid UTC day-shift).
    const nr = nextReview instanceof Date ? nextReview : new Date(nextReview);
    const nextReviewIso = `${nr.getFullYear()}-${String(nr.getMonth() + 1).padStart(2, '0')}-${String(nr.getDate()).padStart(2, '0')}`;

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      new_price: priceString,
      old_price: oldPrice,
      next_review: nextReviewIso,
      warnings
    });
  } catch (err) {
    logger.error('[pricing-apply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to apply price' });
  }
});

module.exports = router;
