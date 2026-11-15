/*
=======================================================================================================================================
API Route: clearance_list
=======================================================================================================================================
Method: GET
Purpose: THE CLEARANCE SCREEN's list (owner, 2026-11-15; design docs/stock-ladder.md → "The Clearance screen", Decisions 1–9). Every
         SKU on step 5 of the Stock ladder, any brand, with Shopify | Amazon | eBay side by side — what each channel says about the
         SKU, or why it can't sell it. Opened from Range's Clearance box (/analytics/slow-sizes/clearance).
         Rules: utils/clearanceList.js (THE copy) — read its header. The writes are the existing routes (size price, eBay size price,
         the eBay listing form, the Amazon step cards); this route only reads.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-11-15",
  "rows": [
    { "code": "B710AP-08", "groupid": "B710AP", "size": "08", "title": "…", "ean": "4061…", "brand": "Goor", "units": 1, "idle_days": 307,
      "last_sale": "2026-01-12", "cost": 13.98, "rrp": 30,
      "shopify": { "live": true, "style_price": 30, "size_price": null, "review": "2026-12-06" },
      "amazon":  { "open": true, "listed": true, "listable": false, "fba": 1, "price": 30, "review": "2026-12-11" },
      "ebay":    { "state": "on", "price": 15, "item_id": "2876…" } }      // state: never | on | style | could
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { loadClearanceList } = require('../utils/clearanceList');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { today, rows } = await loadClearanceList();
    return res.json({ return_code: 'SUCCESS', today, rows });
  } catch (err) {
    logger.error('[clearance-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Clearance list' });
  }
});

module.exports = router;
