/*
=======================================================================================================================================
API Route: product_shopify
=======================================================================================================================================
Method: POST
Purpose: Turn a product's Shopify listing ON or OFF (`skusummary.shopify` 1/0) — and, when turning ON, actually PUSH it to Shopify via
         the Admin API (utils/shopify.js -> productSet). This is the real-time replacement for the legacy "Full product CSV upload":
         flip the toggle and the product (with its sizes, price, title, image) appears on the store.

         ENABLE (shopify=true) — the important path:
           1. We push FIRST (upsertProduct), then set shopify=1 only if the push succeeded. So the two systems stay consistent: either
              the product is live on Shopify AND flagged on, or neither. A push failure leaves shopify=0 and the user simply retries.
           2. upsertProduct enforces the guards for us and we map its coded errors to return_codes:
                - PRICE_REQUIRED  — live price must be > 0 (never publish a product at 0.00; the open "unpriced product" decision).
                - NO_SIZES        — a product with no sizes has nothing to list.
                - NOT_FOUND       — no such product / missing handle or title.
           3. NEW vs EDIT is decided inside upsertProduct by looking the handle up on Shopify: a brand-new handle gets the
              "Stock Code: <groupid>" placeholder description; an existing one is updated WITHOUT touching the owner's real description.
           4. `status` (optional, ACTIVE|DRAFT, default ACTIVE) lets us create as a DRAFT for a safe first live test before going public.

         DISABLE (shopify=false): set shopify=0 only. We deliberately do NOT delete/unpublish the Shopify product here (non-destructive;
         whether "off" should also unpublish is an open product decision). The nightly price/inventory scripts already skip shopify=0.

         The `shopify` flag write uses the legacy 'YYYYMMDD HH24:MI:SS' Europe/London `updated` stamp, like the other product routes.
         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "0151181-ARIZONA",   // string, required
  "shopify": true,                // boolean, required — true = enable + push, false = disable
  "status":  "ACTIVE"             // optional, "ACTIVE" | "DRAFT" (enable only; default ACTIVE) — DRAFT for a safe test
}

Success Response (enable):
{ "return_code": "SUCCESS", "groupid": "...", "shopify": true, "push": { "productId": "gid://...", "handle": "...", "variantCount": 11, "isNew": true } }
Success Response (disable):
{ "return_code": "SUCCESS", "groupid": "...", "shopify": false }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"           // no groupid, or shopify not a boolean
"NOT_FOUND"                // product missing (or has no handle/title)
"PRICE_REQUIRED"           // enabling but live price <= 0
"NO_SIZES"                 // enabling but the product has no sizes
"SHOPIFY_NOT_CONFIGURED"   // SHOPIFY_* env vars missing
"SHOPIFY_PUSH_FAILED"      // transport/HTTP/GraphQL failure talking to Shopify
"SHOPIFY_USER_ERRORS"      // Shopify rejected the productSet (message carries detail)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const shopify = require('../utils/shopify');

router.use(verifyToken);

// Legacy `updated` stamp — UK wall-clock, matches the other product routes.
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// The coded errors upsertProduct can throw that map straight through to a return_code (anything else -> SERVER_ERROR).
const PASS_THROUGH = new Set([
  'NOT_FOUND', 'PRICE_REQUIRED', 'NO_SIZES', 'SHOPIFY_NOT_CONFIGURED', 'SHOPIFY_PUSH_FAILED', 'SHOPIFY_USER_ERRORS'
]);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = (body.groupid || '').trim();
    if (!groupid || typeof body.shopify !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and a boolean shopify are required' });
    }
    // status only applies to enable; whitelist it so we never forward junk to Shopify.
    const status = String(body.status || 'ACTIVE').toUpperCase() === 'DRAFT' ? 'DRAFT' : 'ACTIVE';

    // Confirm the product exists up front so DISABLE (which doesn't call Shopify) still returns a clean NOT_FOUND.
    const exists = await query(`SELECT 1 FROM skusummary WHERE groupid = $1`, [groupid]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `No product with groupid ${groupid}` });
    }

    // -------------------------------------------------------------------------------------------------------------------------------
    // DISABLE — flag only, non-destructive.
    // -------------------------------------------------------------------------------------------------------------------------------
    if (body.shopify === false) {
      await query(`UPDATE skusummary SET shopify = 0, updated = ${UPDATED_EXPR}, updated_date = now() WHERE groupid = $1`, [groupid]);
      return res.json({ return_code: 'SUCCESS', groupid, shopify: false });
    }

    // -------------------------------------------------------------------------------------------------------------------------------
    // ENABLE — push first, then flag. upsertProduct enforces price/size/handle guards and decides NEW vs EDIT itself.
    // -------------------------------------------------------------------------------------------------------------------------------
    if (!shopify.isConfigured()) {
      return res.json({ return_code: 'SHOPIFY_NOT_CONFIGURED', message: 'Shopify API is not configured on the server' });
    }

    let push;
    try {
      push = await shopify.upsertProduct(groupid, { status });
    } catch (err) {
      if (err && PASS_THROUGH.has(err.code)) {
        // Flag is left untouched (still off) so state stays consistent — the user fixes the cause and retries.
        return res.json({ return_code: err.code, message: err.message });
      }
      throw err; // unexpected -> SERVER_ERROR below
    }

    // Push succeeded — now mark it live. (Tiny window if this UPDATE fails: product is live but flag off; re-enabling finds the
    // existing product via handle, updates without duplicating, and sets the flag.)
    await query(`UPDATE skusummary SET shopify = 1, updated = ${UPDATED_EXPR}, updated_date = now() WHERE groupid = $1`, [groupid]);

    return res.json({ return_code: 'SUCCESS', groupid, shopify: true, push });
  } catch (err) {
    logger.error('[product-shopify] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update Shopify status' });
  }
});

module.exports = router;
