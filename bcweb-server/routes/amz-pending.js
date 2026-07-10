/*
=======================================================================================================================================
API Route: amz_pending
=======================================================================================================================================
Method: GET
Purpose: The upload "basket" — the price changes logged but not yet live on Amazon (see utils/amzPending.js for how "pending" is
         derived from the phantom-diff, no extra column). Drives the header "Upload file (N)" badge and lets the UI overlay a
         "pending upload" tag on affected rows (whose amzfeed price is still the old one until the next overnight refresh).

Read-only.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "count": 3,
  "rows": [ { "code": "...", "amz_sku": "AD-0XF8D-48L", "new_price": 39.79, "live_price": 39.29, "rrp": 45.00, "segment": "IVES-WHITE", "log_date": "2026-07-10" }, ... ]
}
=======================================================================================================================================
Return Codes: "SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { getPending } = require('../utils/amzPending');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const rows = await getPending();
    return res.json({ return_code: 'SUCCESS', count: rows.length, rows });
  } catch (err) {
    logger.error('[amz-pending] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load pending changes' });
  }
});

module.exports = router;
