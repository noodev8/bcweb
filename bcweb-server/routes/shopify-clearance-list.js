/*
=======================================================================================================================================
API Route: shopify_clearance_list
=======================================================================================================================================
Method: GET
Purpose: Winners → Slow: what is IN the clearance collection right now (every product tagged `clearance` on Shopify). Since 2026-10-14
         being in the collection and being sitting are separate facts — only the owner puts a style in or takes a style
         out (POST /shopify-clearance-set). Slow uses this for the "In collection" pill on the sitting rows and for the list of styles
         still in the collection that are no longer sitting (they sold — the campaign is working — but stay in until the owner says).
         Since 2026-10-14 the DATABASE is the record (collection_member, tag 'clearance' — the Collections screen), so this is a
         database read; it read Shopify live until then. Rules in utils/clearanceTag.js and utils/collectionTags.js.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "items": [
    { "groupid": "1019051-ARIZONA",          // never null since 2026-10-14 (membership is by groupid)
      "handle": "…", "title": "…",
      "price": 25.00 | null,                 // skusummary.shopifyprice (null if blank/junk)
      "units": 6 | null,                     // live pairs, local #FREE + Amazon (the Slow definition)
      "sitting": false }                     // still on the sitting list?
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"SHOPIFY_NOT_CONFIGURED"
"SHOPIFY_PUSH_FAILED"      // kept for the client; a database read no longer raises it
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { loadCollection } = require('../utils/clearanceTag');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const items = await loadCollection();
    return res.json({ return_code: 'SUCCESS', items });
  } catch (err) {
    logger.error('[shopify-clearance-list] error:', err.message);
    if (err.code === 'SHOPIFY_NOT_CONFIGURED' || err.code === 'SHOPIFY_PUSH_FAILED') {
      return res.json({ return_code: err.code, message: err.message });
    }
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to read the clearance collection' });
  }
});

module.exports = router;
