/*
=======================================================================================================================================
API Route: pricing_apply
=======================================================================================================================================
Method: POST
Purpose: Stage 3 write W1 (CLAUDE.md) — apply a new Shopify price to a style AND stamp the review cooldown, atomically, then record an
         audit row. This is the core write of the module.

Rules enforced here:
  - A review period is OPTIONAL (owner decision — mirrors the Add/Modify price editor's "None"). If supplied it must be an integer
    >= 1; if omitted/blank/null we leave next_shopify_price_review UNTOUCHED (no silent default either way). (Was previously required;
    CLAUDE.md W1 updated to match.)
  - An optional free-text `note` is stored in price_change_log.reason_notes (was hardcoded '' before). It's length-capped server-side.
  - Server-side bounds (never trust the client, which also enforces them for UX):
        BLOCK    newPrice < cost           -> PRICE_BELOW_COST
        ALLOW+FLAG newPrice > rrp              (returned in `warnings`)
    (A bound that is NULL/blank in the DB is simply not checked. The min/maxshopifyprice bounds were removed per owner — unused.)
  - Money: round to 2dp before writing; shopifyprice is VARCHAR so write it as a 2dp STRING (e.g. '36.95') (CLAUDE.md).
  - shopifychange is deliberately NOT set. This route now pushes the new price to Shopify IMMEDIATELY via the Admin API
    (utils/shopify.js -> pushIfLive), exactly like the Add/Modify module's product-price route. Setting the nightly-sync flag too
    would double-push (once now, once overnight). The push is best-effort and runs AFTER the DB write commits (owner decision:
    "pure direct push" — on failure we surface it in the response and the operator re-Applies; there is no nightly fallback).
  - Same reasoning applies to Google: right after the Shopify push, this route also pushes the new price to Google Merchant Center's
    Content API (utils/googleMerchant.js -> pushIfLive), so Google Shopping/ads doesn't show a stale price until the next nightly
    C:\scripts\merchant-feed\merchant_feed.py --upload cron run. Best-effort, never blocks/rolls back the DB write; only fires when
    the style is live on Google (skusummary.googlestatus=1 AND shopify=1) and Google creds are configured.
  - changed_by = req.user.display_name, resolved by verifyToken from the token's id — NEVER sent by the client (CLAUDE.md).
  - The UPDATE + INSERT run inside withTransaction so they both land or neither does (audit can't drift from the price).
=======================================================================================================================================
Request Payload:
{
  "groupid":    "ABC123",  // string, required
  "newPrice":   37.95,     // number, required, > 0 (rounded to 2dp server-side)
  "reviewDays": 7,         // integer >= 1, OPTIONAL; omit/blank/null = "None" (leave the review date untouched)
  "note":       "pace held on the last rise"  // string, OPTIONAL; stored in price_change_log.reason_notes
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "new_price": "37.95",            // the 2dp string actually written
  "old_price": 36.95,             // previous numeric price (null if none)
  "next_review": "2026-07-11",    // CURRENT_DATE + reviewDays, or null when review was None / left untouched
  "warnings": ["ABOVE_RRP"],       // any non-blocking flags (ABOVE_RRP); [] if none
  "shopify": { "pushed": true, "isNew": false, "variantCount": 11 },  // direct Shopify push outcome (see below); null if not live
  "google": { "pushed": true, "updated": 11, "failed": 0, "total": 11 }  // direct Google Merchant push outcome (see below); null if not applicable
}
Shopify push outcome (`shopify` field): null = product not live (skusummary.shopify != 1) or Shopify not configured — nothing pushed;
{ pushed:true, ... } = the new price reached Shopify; { pushed:false, error, message } = DB save stands but the push failed (retry Apply).
Google push outcome (`google` field): null = not live on Google (skusummary.googlestatus != 1), Google not configured, or no googleid
assigned to any size yet — nothing pushed; { pushed:true, updated, failed, total } = ran (a groupid can have multiple googleids, one per
size — failed/total > 0 means some sizes' pushes errored, but the DB price stands either way); { pushed:false, error, message } = the whole
run failed (retry Apply — no automatic fallback; the nightly feed will still pick it up eventually).
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_PRICE"
"INVALID_REVIEW_DAYS"
"PRICE_BELOW_COST"
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
const shopify = require('../utils/shopify');
const googleMerchant = require('../utils/googleMerchant');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.post('/', async (req, res) => {
  try {
    const { groupid } = req.body || {};
    const newPriceRaw = req.body ? req.body.newPrice : undefined;
    const reviewDaysRaw = req.body ? req.body.reviewDays : undefined;

    // 1) Presence. reviewDays is OPTIONAL now (owner decision — "None" is allowed, mirroring the Add/Modify price editor).
    if (!groupid || newPriceRaw === undefined || newPriceRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and newPrice are required' });
    }

    // 2) Validate price: a positive, finite number. Round to 2dp (CLAUDE.md) and format as the string we will store.
    const newPriceNum = Number(newPriceRaw);
    if (!Number.isFinite(newPriceNum) || newPriceNum <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'newPrice must be a positive number' });
    }
    const roundedPrice = Math.round(newPriceNum * 100) / 100;
    const priceString = roundedPrice.toFixed(2); // e.g. '37.95' — written to the varchar column

    // 3) Optional review period. Absent/blank/null -> leave next_shopify_price_review untouched. If supplied, must be an integer >= 1.
    let reviewDays = null; // null = don't touch the review column
    if (reviewDaysRaw !== undefined && reviewDaysRaw !== null && String(reviewDaysRaw).trim() !== '') {
      const n = Number(reviewDaysRaw);
      if (!Number.isInteger(n) || n < 1) {
        return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
      }
      reviewDays = n;
    }

    // Optional free-text note for the audit row (trimmed, length-capped). changed_by is resolved server-side below — never from note.
    const noteRaw = req.body ? req.body.note : undefined;
    const note = (noteRaw === undefined || noteRaw === null ? '' : String(noteRaw)).trim().slice(0, 500);

    // 4) Load the current row for bounds + the old price for the audit log. Prices are legacy VARCHARs that can hold junk, so cast
    //    with safeNumeric (NULL on non-numeric). A bound that reads back NULL is simply not enforced (can't check what we can't read).
    const cur = await query(`
      SELECT ${safeNumeric('shopifyprice')}    AS now,
             ${safeNumeric('cost')}            AS cost,
             ${safeNumeric('rrp')}             AS rrp
      FROM skusummary WHERE groupid = $1
    `, [groupid]);

    if (cur.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const row = cur.rows[0];
    const oldPrice = num(row.now);
    const cost = num(row.cost);
    const rrp = num(row.rrp);

    // 5) BLOCKING bound (only checked when cost is known). Enforced here regardless of the client. (min bound removed per owner.)
    if (cost !== null && roundedPrice < cost) {
      return res.json({ return_code: 'PRICE_BELOW_COST', message: `Price ${priceString} is below cost ${cost.toFixed(2)}` });
    }

    // 6) NON-blocking flag — allowed but surfaced so the UI can warn. (max bound removed per owner; only ABOVE_RRP remains.)
    const warnings = [];
    if (rrp !== null && roundedPrice > rrp) warnings.push('ABOVE_RRP');

    const changedBy = req.user.display_name; // resolved server-side from the token — never from the client body

    // 7) Atomic write (W1, CLAUDE.md) — UPDATE skusummary + INSERT price_change_log in one transaction.
    const nextReview = await withTransaction(async (client) => {
      // W1 UPDATE — shopifyprice as string ($2). shopifychange is intentionally NOT set: we push to Shopify directly after this
      // transaction commits (see pushIfLive below), so the nightly-sync flag would double-push. The review cooldown is set only when a
      // period was supplied — with "None" we leave next_shopify_price_review completely untouched (build the SET clause both ways).
      const setReview = reviewDays !== null ? `, next_shopify_price_review = CURRENT_DATE + $3::int` : '';
      const updParams = reviewDays !== null ? [groupid, priceString, reviewDays] : [groupid, priceString];
      const upd = await client.query(`
        UPDATE skusummary
           SET shopifyprice = $2${setReview}
         WHERE groupid = $1
         RETURNING next_shopify_price_review
      `, updParams);

      // W1 INSERT — audit row: (groupid, 'SHP', old_price, new_price, reason_code NULL, reason_notes, changed_by). reason_notes now
      // carries the optional user note (was hardcoded ''); reason_code stays NULL by design (CLAUDE.md). change_date defaults to today.
      await client.query(`
        INSERT INTO price_change_log
           (groupid, channel, old_price, new_price, reason_code, reason_notes, changed_by)
        VALUES ($1, 'SHP', $2, $3, NULL, $4, $5)
      `, [groupid, oldPrice, roundedPrice, note, changedBy]);

      return upd.rows[0].next_shopify_price_review;
    });

    // Format the returned cooldown date as YYYY-MM-DD (local components to avoid UTC day-shift). Null when the style has no review
    // date (review was None and none existed before) — don't coerce null through new Date() (that would yield the epoch).
    let nextReviewIso = null;
    if (nextReview) {
      const nr = nextReview instanceof Date ? nextReview : new Date(nextReview);
      nextReviewIso = `${nr.getFullYear()}-${String(nr.getMonth() + 1).padStart(2, '0')}-${String(nr.getDate()).padStart(2, '0')}`;
    }

    // Push the new price to Shopify NOW (best-effort). Only fires when the style is live (skusummary.shopify=1) and Shopify is
    // configured; otherwise returns null and nothing is sent. Never throws, so a Shopify hiccup can't undo the committed price/review.
    // Owner decision: no shopifychange fallback — a failure is surfaced here and the operator re-Applies (productSet is idempotent).
    const shopifyResult = await shopify.pushIfLive(groupid);

    // Push the new price to Google Merchant Center NOW too (best-effort, same timing/semantics as the Shopify push above). Without
    // this, Google Shopping/ads would show the old price until the next nightly merchant_feed.py --upload cron run (utils/googleMerchant.js).
    const googleResult = await googleMerchant.pushIfLive(groupid);

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      new_price: priceString,
      old_price: oldPrice,
      next_review: nextReviewIso,
      warnings,
      shopify: shopifyResult,
      google: googleResult
    });
  } catch (err) {
    logger.error('[pricing-apply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to apply price' });
  }
});

module.exports = router;
