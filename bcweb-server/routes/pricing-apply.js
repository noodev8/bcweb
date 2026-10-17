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
        ALLOW+FLAG newPrice < cost             (returned in `warnings` as BELOW_COST — was a hard block until 2026-10-11, owner)
        ALLOW+FLAG newPrice > rrp              (returned in `warnings` as ABOVE_RRP)
    (A bound that is NULL/blank in the DB is simply not checked. The min/maxshopifyprice bounds were removed per owner — unused.)
  - Money: round to 2dp before writing; shopifyprice is VARCHAR so write it as a 2dp STRING (e.g. '36.95') (CLAUDE.md).
  - shopifychange is deliberately NOT set. This route now pushes the new price to Shopify IMMEDIATELY via the Admin API
    (utils/shopify.js -> pushIfLive), exactly like the Add/Modify module's product-price route. Setting the nightly-sync flag too
    would double-push (once now, once overnight). The push is best-effort and runs AFTER the DB write commits (owner decision:
    "pure direct push" — on failure we surface it in the response and the operator re-Applies; there is no nightly fallback).
  - Google is DECOUPLED (2026-07-24): this route does NOT push to Google. The change is logged to price_change_log; a periodic sweep
    (scripts/google-price-sweep.js, run every ~2h by the VPS scheduler) sends un-sent SHP changes to Google Merchant Center in one
    deduped pass and stamps price_change_log.google_pushed_at. Keeps Apply fast when thrashing through many changes; nightly
    merchant_feed.py --upload is the backstop. (Add/Modify's product-price still pushes Google inline — it doesn't log to price_change_log.)
  - changed_by = req.user.display_name, resolved by verifyToken from the token's id — NEVER sent by the client (CLAUDE.md).
  - The UPDATE + INSERT run inside withTransaction so they both land or neither does (audit can't drift from the price).
  - The write itself (the bounds, the hold rule, the UPDATE + INSERT) lives in utils/priceWrite.js → writeShopifyPrice since
    2026-10-17, shared with the Pricing Slider so both write a Shopify price by the same rules. This route keeps the request
    validation, the Shopify push and the response.
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
  "warnings": ["ABOVE_RRP"],       // any non-blocking flags (BELOW_COST, ABOVE_RRP); [] if none
  "shopify": { "pushed": true, "isNew": false, "variantCount": 11 }  // direct Shopify push outcome (see below); null if not live
}
Shopify push outcome (`shopify` field): null = product not live (skusummary.shopify != 1) or Shopify not configured — nothing pushed;
{ pushed:true, ... } = the new price reached Shopify; { pushed:false, error, message } = DB save stands but the push failed (retry Apply).
Google: NOT in this response — Google is decoupled. The change is logged to price_change_log and sent to Google by the periodic sweep
(scripts/google-price-sweep.js); the nightly merchant_feed.py --upload is the backstop.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_PRICE"
"INVALID_REVIEW_DAYS"
"MATCH_LOCKED"        // style is auto-matched to Amazon — turn matching off to price manually
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeShopifyPrice } = require('../utils/priceWrite');
const logger = require('../utils/logger');
const shopify = require('../utils/shopify');
// Google is NOT pushed here — it's decoupled to the periodic sweep (scripts/google-price-sweep.js). See the push section below.

router.use(verifyToken);

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

    const changedBy = req.user.display_name; // resolved server-side from the token — never from the client body

    // 4) Atomic write (W1, CLAUDE.md) — UPDATE skusummary + INSERT price_change_log in one transaction, by the shared rules in
    //    utils/priceWrite.js: the bounds are flagged not blocked (BELOW_COST, ABOVE_RRP), a same price is a hold, and an auto-matched
    //    style is refused (MATCH_LOCKED — the amz-match autopilot would overwrite a manual price; retired, every row false).
    const written = await withTransaction((client) =>
      writeShopifyPrice(client, { groupid, price: roundedPrice, reviewDays, note, changedBy }));
    if (written.error) {
      return res.json({ return_code: written.error, message: written.message });
    }
    const { oldPrice, warnings, isHold, nextReview } = written;

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
    // A same-price apply is a HOLD (docs/hold-logging-spec.md): logged and review-dated, but there is nothing to tell Shopify, so we
    // don't touch their server (owner, 2026-09-30). null = "nothing sent", the same as a style that isn't live.
    const shopifyResult = isHold ? null : await shopify.pushIfLive(groupid);

    // Google is DECOUPLED (2026-07-24): this route no longer pushes to Google Merchant Center. The change is already recorded in
    // price_change_log above; the periodic sweep (scripts/google-price-sweep.js, run every ~2h by the VPS scheduler) picks up un-sent
    // SHP changes, pushes each Google-live style's CURRENT price ONCE (dedup), and stamps price_change_log.google_pushed_at. This keeps
    // Apply fast when thrashing through many changes; the nightly merchant_feed.py --upload remains the ultimate backstop.

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      new_price: priceString,
      old_price: oldPrice,
      next_review: nextReviewIso,
      warnings,
      shopify: shopifyResult
    });
  } catch (err) {
    logger.error('[pricing-apply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to apply price' });
  }
});

module.exports = router;
