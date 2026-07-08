/*
=======================================================================================================================================
API Route: product_price
=======================================================================================================================================
Method: POST
Purpose: Save the price fields on skusummary for the Add / Modify Product module: Cost, RRP, Tax, and the base Shopify price. This is
         the module's price stage. It is NOT the harvest/review workflow (`pricing-apply`, W1) — it doesn't enforce the min/max bounds
         and it doesn't set `shopifychange` (this module pushes live to Shopify directly via the Admin API, see `pushIfLive` below —
         setting the nightly-sync flag too would double-push). By owner decision this route:
           - Enforces the legacy PowerBuilder validation: Cost > 0, RRP > 0, and RRP must be >= Cost. If the Shopify price comes in
             blank/<=0 it defaults to RRP (legacy behaviour), so a new product always has a sensible sell price.
           - AUDIT: writes a `price_change_log` row ('SHP') whenever the Shopify sell price actually changes (old != new), so every
             price change from this screen is traceable — mirroring the harvest workflow's audit (owner decision). `changed_by` is
             resolved server-side from the token, never sent by the client. reason_code is intentionally NOT written (the owner plans to
             drop that column) — we omit it from the INSERT so the write survives its removal. An optional free-text `note` from the user
             lands in `reason_notes`; it only persists on a logged price change (no change = no row = nothing to attach a note to).
           - REVIEW (optional): if the user supplies `reviewDays` (integer >= 1) we also stamp `next_shopify_price_review = today+N`,
             which parks the style out of the pricing triage/losers lists until then — the same column the harvest workflow uses. Unlike
             W1, here it is OPTIONAL: omitted/blank leaves the column untouched. It is independent of the price change (you can park
             without changing the price).

         Money columns on skusummary are legacy VARCHAR, so we WRITE 2dp strings (e.g. '39.95'), never numbers (CLAUDE.md). Tax is the
         legacy 0/1 integer flag. `updated` uses the legacy 'YYYYMMDD HH24:MI:SS' Europe/London format. Single-row write, still wrapped
         in withTransaction for consistency with the other write routes. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid":      "0128221-GIZEH", // string, required
  "cost":         18.75,           // number|string, required, > 0
  "rrp":          45.00,           // number|string, required, > 0 and >= cost
  "tax":          true,            // boolean -> 1/0
  "shopifyPrice": 39.95,           // number|string, optional; <= 0 / blank defaults to rrp
  "reviewDays":   14,              // integer >= 1, OPTIONAL; sets next_shopify_price_review = today+N (omit/blank = leave untouched)
  "note":         "seasonal bump"  // string, OPTIONAL; stored in price_change_log.reason_notes, only when the price actually changes
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128221-GIZEH",
  "saved": { "cost": 18.75, "rrp": 45.00, "tax": true, "price": 39.95 },  // numbers actually written (price is the 2dp value)
  "logged": true,                 // true if a price_change_log row was written (i.e. the Shopify price changed)
  "next_review": "2026-07-22"     // next_shopify_price_review after the write (YYYY-MM-DD), or null if none set
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"        // no groupid
"INVALID_PRICE"         // cost or rrp not a positive number, or rrp < cost
"INVALID_REVIEW_DAYS"   // reviewDays supplied but not an integer >= 1
"NOT_FOUND"             // no such product
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');
const shopify = require('../utils/shopify');

router.use(verifyToken);

const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// Parse a money input (number or string) to a finite number, or null if blank/invalid. Empty string / null -> null (not 0), so we can
// tell "not supplied" from "zero".
function parseMoney(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN; // NaN signals "supplied but not a valid number" -> caller rejects
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = (body.groupid || '').trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    const cost = parseMoney(body.cost);
    const rrp = parseMoney(body.rrp);
    let price = parseMoney(body.shopifyPrice);
    const tax = body.tax === true || body.tax === 1 || body.tax === '1' ? 1 : 0;

    // Optional review period. Absent/blank -> don't touch next_shopify_price_review. If supplied it must be an integer >= 1 (a real
    // park decision), else reject — never silently coerce a bad value.
    const reviewRaw = body.reviewDays;
    let reviewDays = null; // null = leave the review column untouched
    if (reviewRaw !== undefined && reviewRaw !== null && String(reviewRaw).trim() !== '') {
      const n = Number(reviewRaw);
      if (!Number.isInteger(n) || n < 1) {
        return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
      }
      reviewDays = n;
    }

    // Optional free-text note for the audit row. Trimmed and length-capped; only persisted if a price change is actually logged.
    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500);

    // Legacy validation (enforced server-side, never trust the client): Cost and RRP are required and must be positive numbers.
    if (cost === null || Number.isNaN(cost) || cost <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'Cost is required and must be greater than 0' });
    }
    if (rrp === null || Number.isNaN(rrp) || rrp <= 0) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'RRP is required and must be greater than 0' });
    }
    // RRP must cover cost (legacy: "RRP is less than cost").
    if (rrp < cost) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'RRP cannot be less than cost' });
    }
    // Shopify price supplied but non-numeric -> reject; blank / <= 0 -> default to RRP (legacy behaviour).
    if (Number.isNaN(price)) {
      return res.json({ return_code: 'INVALID_PRICE', message: 'Shopify price must be a number' });
    }
    if (price === null || price <= 0) price = rrp;

    // Round to 2dp and format as the strings we store in the VARCHAR columns.
    const round2 = (n) => Math.round(n * 100) / 100;
    const costNum = round2(cost);
    const rrpNum = round2(rrp);
    const priceNum = round2(price);
    const costStr = costNum.toFixed(2);
    const rrpStr = rrpNum.toFixed(2);
    const priceStr = priceNum.toFixed(2);

    const changedBy = req.user.display_name; // resolved server-side from the token — never from the client body

    const { logged, nextReview } = await withTransaction(async (client) => {
      // Read the current Shopify price first so we can (a) detect whether it actually changed and (b) record old->new in the audit log.
      // Legacy VARCHAR that can hold junk, so read via safeNumeric (NULL when non-numeric); a null old price counts as "changed".
      const before = await client.query(
        `SELECT ${safeNumeric('shopifyprice')} AS oldp FROM skusummary WHERE groupid = $1`,
        [groupid]
      );
      if (before.rows.length === 0) {
        const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e;
      }
      const oldRaw = before.rows[0].oldp;
      const oldNum = oldRaw === null || oldRaw === undefined ? null : Number(oldRaw);
      const priceChanged = oldNum === null || Math.round(oldNum * 100) !== Math.round(priceNum * 100);

      // shopifychange is deliberately NOT set (this module pushes to Shopify directly below — the nightly flag would double-push).
      // Stamp next_shopify_price_review only when a review period was supplied (optional here, unlike the harvest W1). Build the SET
      // clause both ways so the review column is left completely untouched when reviewDays is null. RETURNING echoes the final value.
      const setReview = reviewDays !== null ? `, next_shopify_price_review = CURRENT_DATE + $6::int` : '';
      const params = [groupid, costStr, rrpStr, priceStr, tax];
      if (reviewDays !== null) params.push(reviewDays);
      const upd = await client.query(`
        UPDATE skusummary
           SET cost = $2, rrp = $3, shopifyprice = $4, tax = $5, updated = ${UPDATED_EXPR}, updated_date = now()${setReview}
         WHERE groupid = $1
         RETURNING next_shopify_price_review
      `, params);

      // Audit: log every actual Shopify-price change ('SHP'). reason_code is intentionally omitted from the column list (owner plans to
      // drop it) so this INSERT survives its removal; change_date defaults to CURRENT_DATE. The optional note rides here in reason_notes.
      if (priceChanged) {
        await client.query(`
          INSERT INTO price_change_log
             (groupid, channel, old_price, new_price, reason_notes, changed_by)
          VALUES ($1, 'SHP', $2, $3, $4, $5)
        `, [groupid, oldNum, priceNum, note, changedBy]);
      }

      return { logged: priceChanged, nextReview: upd.rows[0].next_shopify_price_review };
    });

    // Format the review date (if any) as YYYY-MM-DD from local components (avoid a UTC day-shift).
    let nextReviewIso = null;
    if (nextReview) {
      const d = nextReview instanceof Date ? nextReview : new Date(nextReview);
      nextReviewIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // If the product is live on Shopify, re-push so the new price/compareAtPrice reaches the store (best-effort — never fails the save).
    const shopifyResult = await shopify.pushIfLive(groupid);

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      saved: { cost: costNum, rrp: rrpNum, tax: tax === 1, price: priceNum },
      logged,
      next_review: nextReviewIso,
      shopify: shopifyResult,
    });
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    }
    logger.error('[product-price] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save price' });
  }
});

module.exports = router;
