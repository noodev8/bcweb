/*
=======================================================================================================================================
API Route: amz_apply
=======================================================================================================================================
Method: POST
Purpose: The Amazon Pricing write (W-A1, docs/amz-pricing-spec.md §4; auto-park added per segments-spec.md §10.5A) — record a new Amazon
         price for ONE SKU. Deliberately smaller than the Shopify apply: it does NOT change any live price by itself. It writes a single
         amz_price_log row (the audit trail) and returns the SKU + new price + RRP; the price only actually reaches Amazon when the operator
         downloads the one-file Seller Central upload (built client-side in the module's session basket from these apply responses) and
         uploads it. No live push, ever.

         Optional review/park (§10.5A): applying a price can ALSO review the SKU, so when a reviewDays is supplied the SAME transaction
         stamps skumap.next_amz_price_review = CURRENT_DATE + reviewDays. That drops the SKU off the derived segment clock + the winners/
         losers queues (they filter un-parked only) — the Amazon analogue of Shopify's W1 review. Mirroring Shopify W1 exactly, the review
         is OPTIONAL: omitted/blank/null = "None" = leave next_amz_price_review UNTOUCHED (price queued, SKU stays in the list). To review
         WITHOUT pricing, the operator uses the batch POST /amz-review instead.

Rules enforced here (never trust the client):
  - BLOCK  newPrice < hard-floor (cost + FBA fee)      -> PRICE_BELOW_FLOOR   (breakeven; can't knowingly sell at a loss)
  - ALLOW+FLAG newPrice > RRP                            -> warnings:['ABOVE_RRP']
    (The tidy working-floor and any discovered ceiling are *guidance in the suggestion*, not hard write bounds — the playbook
     deliberately clears dead piles below the tidy floor and harvests above prior levels. Only breakeven and RRP are hard here.)
  - Money rounded to 2dp. amz_price_log.old_price/new_price are numeric columns, so numbers are written (not strings).
  - NEVER write amzfeed (it is refreshed nightly from Amazon — any write is clobbered; hard rule from AMZ_PRICING.md).
  - The optional `note` carries the operator's rationale (the row's suggestion "why" is a good default the client can pass). Capped.

Schema note: amz_price_log is (id, log_date, code, old_price, new_price, notes, changed_by). `changed_by` was added 2026-07-10 (nullable
text) so this route now persists the operator (req.user.display_name, resolved by verifyToken) — matching the Shopify price_change_log
convention. `old_price` is NOT NULL, so when the live amzprice reads back NULL (junk/blank VARCHAR) we log the new price as old_price
(a zero-delta 'flat' row) rather than violate the constraint; the response still returns the true old_price (null when unknown).
=======================================================================================================================================
Request Payload:
{ "code": "FLE030-IVES-WHITE-05", "newPrice": 39.79, "note": "creep 0.50 — 14u/7d", "reviewDays": 14 }   // note + reviewDays optional
  // reviewDays omitted/blank/null = "None" (leave the review date untouched — SKU stays in the list); if supplied, integer >= 1.

Success Response:
{ "return_code": "SUCCESS", "code": "...", "amz_sku": "AD-0XF8D-48L", "new_price": 39.79, "old_price": 39.29, "rrp": 45.00,
  "next_review": "2026-07-26", "warnings": ["ABOVE_RRP"] }  // next_review null when review was None. warnings [] if none. amz_sku + rrp
  // let the client basket build the upload file from this response.
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "INVALID_PRICE" · "INVALID_REVIEW_DAYS" · "PRICE_BELOW_FLOOR" · "NOT_FOUND" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const body = req.body || {};
    const { code } = body;
    const newPriceRaw = body.newPrice;

    if (!code || newPriceRaw === undefined || newPriceRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code and newPrice are required' });
    }

    const newPriceNum = Number(newPriceRaw);
    if (!Number.isFinite(newPriceNum) || newPriceNum <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'newPrice must be a positive number' });
    }
    const rounded = Math.round(newPriceNum * 100) / 100;

    // Optional reviewDays for the park (§10.5A), mirroring Shopify W1 exactly: omitted/blank/null = "None" = leave the review date
    // untouched (null below); if supplied it must be an integer >= 1 (same rule as W-seg-1 / the batch mark-reviewed).
    let reviewDays = null; // null = don't touch next_amz_price_review (the SKU stays in the winners/losers list)
    if (body.reviewDays !== undefined && body.reviewDays !== null && String(body.reviewDays).trim() !== '') {
      const n = Number(body.reviewDays);
      if (!Number.isInteger(n) || n < 1) {
        return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
      }
      reviewDays = n;
    }

    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500);

    // Load the SKU's live price (for old_price) + economics for the floor, plus the Amazon SKU + RRP so the response carries everything
    // the client's upload basket needs to build the Seller Central file (amz_sku, new_price, RRP) without a second round-trip.
    // amzfeed is FBA/Amazon truth; cost/rrp on skusummary.
    const cur = await query(`
      SELECT a.sku AS amz_sku,
             ${safeNumeric('a.amzprice')} AS live_price,
             ${safeNumeric('a.fbafee')}   AS fbafee,
             ${safeNumeric('sk.cost')}    AS cost,
             ${safeNumeric('sk.rrp')}     AS rrp
      FROM amzfeed a
      LEFT JOIN skusummary sk ON sk.groupid = a.groupid
      WHERE a.code = $1
    `, [code]);

    if (cur.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    const row = cur.rows[0];
    const oldPrice = num(row.live_price);
    const cost = num(row.cost);
    const fbafee = num(row.fbafee);
    const rrp = num(row.rrp);

    // BLOCK below breakeven (only when both parts are known — can't enforce what we can't read).
    if (cost !== null && fbafee !== null) {
      const hardFloor = Math.round((cost + fbafee) * 100) / 100;
      if (rounded < hardFloor) {
        return res.json({ return_code: 'PRICE_BELOW_FLOOR', message: `Price ${rounded.toFixed(2)} is below the floor ${hardFloor.toFixed(2)} (cost + FBA fee)` });
      }
    }

    const warnings = [];
    if (rrp !== null && rounded > rrp) warnings.push('ABOVE_RRP');

    // old_price is NOT NULL on amz_price_log, but the live amzprice can read back NULL (a junk/blank VARCHAR that safeNumeric couldn't
    // parse). Guard it: log the new price as old_price in that case (a zero-delta 'flat' audit row) rather than 500 on the constraint or
    // fabricate a false delta. The RESPONSE keeps the true oldPrice (null when unknown) so the UI/basket shows "—" for the prior price.
    const oldForLog = oldPrice !== null ? oldPrice : rounded;
    // changed_by = the logged-in operator, resolved server-side by verifyToken from the token's id — never sent by the client (CLAUDE.md).
    const changedBy = req.user.display_name;

    // INSERT the audit row AND (when a period was given) park the SKU in one transaction (spec §10.5A) — so a park can never land without
    // its log row, nor vice-versa. This is the only time W-A1 writes a product row (skumap); still never amzfeed (READ ONLY). The skumap
    // row always exists for a real SKU (§10.2), so a plain UPDATE is enough. When reviewDays is null ("None", mirroring Shopify W1) we skip
    // the park entirely — the review date is left untouched and the SKU stays in the winners/losers list.
    const nextReview = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO amz_price_log (code, old_price, new_price, notes, changed_by) VALUES ($1, $2, $3, $4, $5)`,
        [code, oldForLog, rounded, note, changedBy]
      );
      if (reviewDays === null) return null;
      const upd = await client.query(
        `UPDATE skumap SET next_amz_price_review = CURRENT_DATE + $2::int WHERE code = $1 RETURNING next_amz_price_review`,
        [code, reviewDays]
      );
      return upd.rows[0] ? upd.rows[0].next_amz_price_review : null;
    });

    // Format the park date as YYYY-MM-DD (local components, no UTC day-shift). Null when review was None. Mirrors pricing-apply.
    let nextReviewIso = null;
    if (nextReview) {
      const nr = nextReview instanceof Date ? nextReview : new Date(nextReview);
      nextReviewIso = `${nr.getFullYear()}-${String(nr.getMonth() + 1).padStart(2, '0')}-${String(nr.getDate()).padStart(2, '0')}`;
    }

    return res.json({ return_code: 'SUCCESS', code, amz_sku: row.amz_sku, new_price: rounded, old_price: oldPrice, rrp, next_review: nextReviewIso, warnings });
  } catch (err) {
    logger.error('[amz-apply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to apply Amazon price' });
  }
});

module.exports = router;
