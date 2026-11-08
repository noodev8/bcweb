/*
=======================================================================================================================================
API Route: pricing_size_price_clear
=======================================================================================================================================
Method: POST
Purpose: "Back to style price" for ONE size (owner, 2026-11-08) — the Size prices panel on the Shopify pricing drill. Removes the size's
         own price (utils/sizePrice.js → clearSizePrice), so it sells at the style price again. Any time, by hand; the size price also
         ends by itself when the size sells out or the style price goes to or below it.

         One transaction: the shopify_size_price row deleted + a shopify_size_price_log row ('back') + a bclog row (section 'Shopify
         Pricing'). AFTER the commit the style is pushed to Shopify (pushIfLive, best-effort — on failure `shopify.pushed:false`, press
         again). Google: the un-sent log row is picked up by the 2-hourly sweep, which re-sends the style price for that size (otherwise
         the supplemental sale-price override would keep the old size price on Google).
=======================================================================================================================================
Request Payload:
{ "code": "0034791-MILANO-35" }   // string, required

Success Response:
{ "return_code": "SUCCESS", "code": "0034791-MILANO-35", "groupid": "0034791-MILANO", "size": "35", "old_price": 45.00,
  "shopify": { "pushed": true, ... } }       // null = style not live on Shopify
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_SET"              // the size has no price of its own
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { clearSizePrice } = require('../utils/sizePrice');
const { writeBcLog } = require('../utils/bclog');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    const by = req.user.display_name;

    const written = await withTransaction(async (client) => {
      const w = await clearSizePrice(client, { code, by });
      if (w.error) return w;
      await writeBcLog(client, { who: by, section: 'Shopify Pricing', log: `Size price ${code}: back to style price (was £${w.oldPrice.toFixed(2)})` });
      return w;
    });
    if (written.error) return res.json({ return_code: written.error, message: written.message });

    const shopifyResult = await shopify.pushIfLive(written.groupid);

    return res.json({
      return_code: 'SUCCESS', code, groupid: written.groupid, size: written.size, old_price: written.oldPrice, shopify: shopifyResult,
    });
  } catch (err) {
    logger.error('[pricing-size-price-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to clear the size price' });
  }
});

module.exports = router;
