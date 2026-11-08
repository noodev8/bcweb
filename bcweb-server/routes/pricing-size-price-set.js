/*
=======================================================================================================================================
API Route: pricing_size_price_set
=======================================================================================================================================
Method: POST
Purpose: Give ONE size of a style its own Shopify price (owner, 2026-11-08) — the Size prices panel on the Shopify pricing drill. For a
         dead size of a selling style (Milano 35: 5 pairs, never sells), so the style price stays where it earns. On Shopify the size
         shows this price with the RRP crossed out, like every other size; it ends by itself when the size sells out, when the style price goes to or
         below it, or by hand (POST /pricing-size-price-clear). Rules: utils/sizePrice.js (THE copy).

         - Set BY HAND; the screen fills in 50% of RRP. Must be BELOW the style price and the size must have stock (refused otherwise —
           NOT_BELOW_STYLE / NO_STOCK). Below cost is FLAGGED, never blocked (BELOW_COST — as W1).
         - No review date (owner's plan: it ends when the size sells out; a style review date would hide a selling style).
         - One transaction: shopify_size_price upserted + a shopify_size_price_log row (never price_change_log — that is the STYLE's
           price history) + a bclog row (section 'Shopify Pricing').
         - AFTER the commit, the style is pushed to Shopify (utils/shopify.js → pushIfLive, best-effort, never undoes the save — on
           failure `shopify.pushed:false` and the operator presses Apply again; productSet is idempotent). Google is NOT pushed here:
           the log row is un-sent, so the 2-hourly sweep (scripts/google-price-sweep.js) sends it.
         - changed_by = req.user.display_name (server-side).
=======================================================================================================================================
Request Payload:
{ "code": "0034791-MILANO-35",   // string, required — skumap.code
  "price": 45.00,                // number, required, > 0 (rounded to 2dp)
  "note": "dead size" }          // string, optional

Success Response:
{ "return_code": "SUCCESS", "code": "0034791-MILANO-35", "groupid": "0034791-MILANO", "size": "35",
  "price": 45.00, "old_price": null, "style_price": 82.49, "warnings": ["BELOW_COST"],
  "shopify": { "pushed": true, ... } }       // null = style not live on Shopify
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_PRICE"
"NOT_FOUND"            // no such live size
"NO_STYLE_PRICE"       // the style's Shopify price can't be read
"NOT_BELOW_STYLE"      // a size price must be below the style price
"NO_STOCK"             // the size has nothing to sell
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { setSizePrice } = require('../utils/sizePrice');
const { writeBcLog } = require('../utils/bclog');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    if (!code || body.price === undefined || body.price === null || String(body.price).trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code and price are required' });
    }
    const n = Number(body.price);
    if (!Number.isFinite(n) || n <= 0) return res.json({ return_code: 'INVALID_PRICE', message: 'price must be a positive number' });
    const price = Math.round(n * 100) / 100;
    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500) || null;
    const by = req.user.display_name;

    const written = await withTransaction(async (client) => {
      const w = await setSizePrice(client, { code, price, note, by });
      if (w.error) return w;
      await writeBcLog(client, {
        who: by, section: 'Shopify Pricing',
        log: `Size price ${code}: £${price.toFixed(2)}${w.oldPrice !== null ? ` (was £${w.oldPrice.toFixed(2)})` : ''} — style £${w.stylePrice.toFixed(2)}`,
      });
      return w;
    });
    if (written.error) return res.json({ return_code: written.error, message: written.message });

    const shopifyResult = await shopify.pushIfLive(written.groupid);

    return res.json({
      return_code: 'SUCCESS', code, groupid: written.groupid, size: written.size,
      price, old_price: written.oldPrice, style_price: written.stylePrice, warnings: written.warnings,
      shopify: shopifyResult,
    });
  } catch (err) {
    logger.error('[pricing-size-price-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set the size price' });
  }
});

module.exports = router;
