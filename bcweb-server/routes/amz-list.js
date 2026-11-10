/*
=======================================================================================================================================
API Route: amz_list
=======================================================================================================================================
Method: POST
Purpose: "List on Amazon (FBA)" on Add / Modify (2026-11-10) — ONE style's sizes listed on Amazon as our offer on Amazon's existing
         listing, Fulfilled by Amazon, at the RRP, through the SP-API. Rules in utils/amzListing.js (THE copy).
         Two presses: commit false = CHECK (Amazon validates each size, nothing created, nothing written); commit true = LIST for real,
         then skumap stamped (sku / status '1' / updated) for the sizes Amazon accepted + one bclog row ('Amazon Listing').
         amzfeed is NOT written: Update Orders' FBA stock read adds the new SKUs with ASIN + FNSKU. The .xlsm button
         (POST /product-amazon) stays as the fallback.
         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "72581-00",   // string, required
  "commit": false           // false/omitted = check only; true = list
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "72581-00",
  "committed": false,
  "price": 70,
  "sizes": [
    { "code": "72581-00-37", "ean": "4066707222998", "sku": "72581-00-37-2611", "asin": "B0H4LSX76B", "productType": "BOOT",
      "title": "Rieker …", "state": "ready", "message": null }
    // state: on_amazon | no_barcode | not_in_catalogue | ready (check) | listed (list) | refused (message = Amazon's reason)
  ],
  "counts": { "ready": 5, "not_in_catalogue": 1 }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // no groupid
"NOT_FOUND"        // groupid not in skusummary
"INVALID_RRP"      // RRP blank / not a price
"NO_SIZES"         // no live sizes
"NOT_CONFIGURED"   // SP-API keys or AMZ_SP_SELLER_ID missing from .env
"AMAZON_ERROR"     // Amazon couldn't be reached / the catalogue search failed (per-size refusals are NOT this — they're in sizes[])
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { checkStyle, listStyle, ListingError } = require('../utils/amzListing');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const groupid = String((req.body || {}).groupid || '').trim().toUpperCase();
  const commit = (req.body || {}).commit === true;
  if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });

  try {
    const out = commit ? await listStyle(groupid, req.user.display_name) : await checkStyle(groupid);
    return res.json({ return_code: 'SUCCESS', ...out });
  } catch (err) {
    if (err instanceof ListingError) return res.json({ return_code: err.code, message: err.message });
    if (/not configured/i.test(err.message)) return res.json({ return_code: 'NOT_CONFIGURED', message: err.message });
    if (/^SP-API|^LWA/.test(err.message)) {
      logger.error(`[amz-list] ${groupid}:`, err.message);
      return res.json({ return_code: 'AMAZON_ERROR', message: err.message });
    }
    logger.error(`[amz-list] ${groupid}:`, err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to list on Amazon' });
  }
});

module.exports = router;
