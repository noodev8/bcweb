/*
=======================================================================================================================================
API Route: google_allowance_measure
=======================================================================================================================================
Method: GET
Purpose: The first half of the Google Ads screen's Re-measure button: what the Google allowance WOULD be if re-measured now — Google
         spend / Shopify units over the last 90 complete days of ad data. Nothing is saved; the screen shows this beside the figure in
         force and the owner accepts it (google-allowance-accept) or walks away (owner, 2026-10-25: "display the new fixed number
         before it is accepted"). Was process-allowance-measure until 2026-10-26, when the figure moved from the removed Today screen.
         Rules: utils/googleAllowance.js → measureAllowance. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "measure": { "windowFrom": "2026-07-26", "windowTo": "2026-10-23", "spend": 6191.40, "units": 799, "perUnit": 7.75 }
}
  - perUnit is null when nothing sold on Shopify in the window — there is nothing to accept.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { measureAllowance } = require('../utils/googleAllowance');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const measure = await measureAllowance(query);
    return res.json({ return_code: 'SUCCESS', measure });
  } catch (err) {
    logger.error('[google-allowance-measure] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not measure the Google allowance' });
  }
});

module.exports = router;
