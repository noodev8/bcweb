/*
=======================================================================================================================================
API Route: ebay_size_price
=======================================================================================================================================
Method: POST
Purpose: Set the eBay price of ONE SIZE inside a BCWEB listing (owner, 2026-11-01: dud sizes get "a lower price for that size" inside
         the same listing, set "by hand to start"). WRITES TO EBAY, then records it. eBay prices each variation separately; Shopify's
         price stays per style and is not touched.

THE ORDER:
  1. The size must be on a LIVE BCWEB listing (ebay_listing_size + ebay_listing.ended_at IS NULL) — the trial / hand-made listings
     aren't BCWEB's to price. Price > 0.
  2. eBay: Inventory API bulkUpdatePriceQuantity with the size's offer and the PRICE ONLY — no quantity in the request, so the stock
     sync's figure is left exactly as it is.
  3. Record: ebay_listing_size.price / price_set_at / price_set_by (migrations/20261101b_ebay_size_price.sql) and a bclog row (section
     'eBay'). If the record fails after eBay took the price, RECORD_FAILED says so — the price IS live on eBay.
Going back to the listing's own price is just setting that price.

Requires auth. Who = the logged-in user.
=======================================================================================================================================
Request: POST /ebay-size-price   { "code": "22152-42-019-39", "price": 29.99 }

Success Response: { "return_code": "SUCCESS", "code": "…", "old_price": 55, "new_price": 29.99 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_REQUEST"           no code, or price not above £0
"NOT_ON_EBAY"           the code isn't on a live BCWEB listing
"EBAY_ERROR"            eBay refused (its own words in message) — nothing recorded
"RECORD_FAILED"         eBay has the new price but BCWEB couldn't record it
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { ebayRest } = require('../utils/ebayRest');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const who = req.user.display_name;
  const code = String((req.body && req.body.code) || '').trim();
  const price = Math.round(Number(req.body && req.body.price) * 100) / 100;
  if (!code) return res.json({ return_code: 'BAD_REQUEST', message: 'No size given' });
  if (!Number.isFinite(price) || price <= 0) return res.json({ return_code: 'BAD_REQUEST', message: 'Enter a price above £0' });

  let row;
  try {
    const r = await query(`
      SELECT s.ebay_listing_id, s.offer_id, COALESCE(s.price, e.price) AS old_price, e.item_id, e.groupid
      FROM ebay_listing_size s
      JOIN ebay_listing e ON e.id = s.ebay_listing_id AND e.ended_at IS NULL
      WHERE s.code = $1
    `, [code]);
    row = r.rows[0];
  } catch (err) {
    logger.error('[ebay-size-price] read error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not read the listing' });
  }
  if (!row) return res.json({ return_code: 'NOT_ON_EBAY', message: `${code} isn't on a live BCWEB eBay listing` });

  // eBay — price only.
  try {
    const out = await ebayRest('POST', '/sell/inventory/v1/bulk_update_price_quantity', {
      requests: [{ sku: code, offers: [{ offerId: row.offer_id, price: { value: price.toFixed(2), currency: 'GBP' } }] }],
    });
    const bad = ((out.body && out.body.responses) || []).find((x) => Number(x.statusCode) >= 300);
    if (bad) {
      const msg = Array.isArray(bad.errors) && bad.errors[0] ? (bad.errors[0].longMessage || bad.errors[0].message) : 'eBay refused the price';
      return res.json({ return_code: 'EBAY_ERROR', message: `eBay: ${msg}` });
    }
  } catch (err) {
    logger.error(`[ebay-size-price] ${code} eBay failed:`, err.message);
    return res.json({ return_code: 'EBAY_ERROR', message: err.message });
  }

  const oldPrice = row.old_price === null ? null : Number(row.old_price);
  try {
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE ebay_listing_size SET price = $1, price_set_at = now(), price_set_by = $2 WHERE ebay_listing_id = $3 AND code = $4',
        [price, who, row.ebay_listing_id, code]
      );
      await writeBcLog(client, {
        who,
        section: 'eBay',
        log: `Size price ${code}: £${oldPrice === null ? '?' : oldPrice.toFixed(2)} → £${price.toFixed(2)} (item ${row.item_id})`,
      });
    });
  } catch (err) {
    logger.error(`[ebay-size-price] ${code} priced on eBay at ${price} but the record failed:`, err.message);
    return res.json({ return_code: 'RECORD_FAILED', message: `${code} is £${price.toFixed(2)} on eBay, but BCWEB couldn't record it` });
  }
  return res.json({ return_code: 'SUCCESS', code, old_price: oldPrice, new_price: price });
});

module.exports = router;
