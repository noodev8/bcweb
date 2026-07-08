/*
=======================================================================================================================================
API Route: product_price
=======================================================================================================================================
Method: POST
Purpose: Save the price fields on skusummary for the Add / Modify Product module: Cost, RRP, Tax, and the base Shopify price. This is
         the module's price stage — distinct from the pricing-module W1 (`pricing-apply`), which owns the harvest/review workflow
         (shopifychange + price_change_log + review cooldown + bounds). By owner decision this route:
           - Sets shopifyprice as a plain catalogue value and does NOT touch `shopifychange` — nothing auto-pushes to Shopify from
             here (a direct Shopify API push is wired up later). It also writes NO price_change_log row (that log is the harvest
             workflow's, not catalogue maintenance).
           - Enforces the legacy PowerBuilder validation: Cost > 0, RRP > 0, and RRP must be >= Cost. If the Shopify price comes in
             blank/<=0 it defaults to RRP (legacy behaviour), so a new product always has a sensible sell price.

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
  "shopifyPrice": 39.95            // number|string, optional; <= 0 / blank defaults to rrp
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128221-GIZEH",
  "saved": { "cost": 18.75, "rrp": 45.00, "tax": true, "price": 39.95 }   // numbers actually written (price is the 2dp value)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // no groupid
"INVALID_PRICE"     // cost or rrp not a positive number, or rrp < cost
"NOT_FOUND"         // no such product
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
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

    await withTransaction(async (client) => {
      // shopifychange is deliberately NOT set (owner decision — store value only). No price_change_log row here either.
      const upd = await client.query(`
        UPDATE skusummary
           SET cost = $2, rrp = $3, shopifyprice = $4, tax = $5, updated = ${UPDATED_EXPR}
         WHERE groupid = $1
         RETURNING groupid
      `, [groupid, costStr, rrpStr, priceStr, tax]);

      if (upd.rows.length === 0) {
        const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e;
      }
    });

    // If the product is live on Shopify, re-push so the new price/compareAtPrice reaches the store (best-effort — never fails the save).
    const shopifyResult = await shopify.pushIfLive(groupid);

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      saved: { cost: costNum, rrp: rrpNum, tax: tax === 1, price: priceNum },
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
