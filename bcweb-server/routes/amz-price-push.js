/*
=======================================================================================================================================
API Route: amz_price_push
=======================================================================================================================================
Method: POST
Purpose: The "Send to Amazon" button (2026-11-11, in place of the upload file's "Upload file · N"): sends every pending Amazon price — the
         upload basket — to Amazon through the SP-API (utils/amzPricePush.js, THE rules). An Apply already sends its own SKU
         (routes/amz-apply.js) and Update Orders retries, so this is the by-hand retry for anything Amazon refused or that failed to send.
         Nothing about a failure is stored (owner): the reasons come back here for the screen, and the row stays pending.
=======================================================================================================================================
Request Payload: { "codes": ["FLE030-IVES-WHITE-05"] }   optional — omitted = everything pending

Success Response:
{
  "return_code": "SUCCESS",
  "sent":   [{ "code": "FLE030-IVES-WHITE-05", "price": 39.29 }],
  "failed": [{ "code": "M113BT-10", "price": 47.00, "message": "A 'Your Price' value '47.' is not less than or equal to 'Maximum…'" }]
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOT_CONFIGURED" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { pushAmzPrices } = require('../utils/amzPricePush');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const codes = Array.isArray(req.body && req.body.codes) ? req.body.codes.map(String).filter(Boolean) : null;
    const r = await pushAmzPrices({ codes, who: req.user.display_name });
    if (r.skipped) return res.json({ return_code: 'NOT_CONFIGURED', message: r.skipped });
    return res.json({ return_code: 'SUCCESS', sent: r.sent, failed: r.failed });
  } catch (err) {
    logger.error('[amz-price-push] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to send prices to Amazon' });
  }
});

module.exports = router;
