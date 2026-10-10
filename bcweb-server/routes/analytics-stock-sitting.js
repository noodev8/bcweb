/*
=======================================================================================================================================
API Route: analytics_stock_sitting
=======================================================================================================================================
Method: GET
Purpose: Reports -> Stock vs Sales: stock now split SELLING | SITTING | NEW (the three boxes) and the sitting styles (the list under
         them). Owner, 2026-10-10: "Stock comes in, goes out, happy. Sits, not happy so I push it."

         THE RULE LIVES IN utils/stockSitting.js — read its header for what sitting / new mean and why (60 days, any channel, deliveries
         ignored, new = product age). It is shared with GET /pricing-sitting-list (the Repricing list of the same styles), so the box,
         this list and the Repricing list always agree. This route is just the HTTP wrapper.

         Stock is LIVE, so `total_units` can differ from the page's nightly stock_daily reading by today's movement.
         All sitting styles are returned — the count IS the job, same as the Repricing lists. Most pairs first.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "days": 60,
  "new_days": 60,                      // = days; kept separate so the screen never assumes it
  "total_units": 2917,                 // all stock, live — the three parts below always add up to it
  "selling_units": 2527,
  "new_units": 92,
  "sitting_units": 298,                // = the styles below
  "styles": [
    { "groupid": "1017722-BEND", "title": "Birkenstock Bend Low Natural", "brand": "Birkenstock",
      "units": 24, "last_sale": "2026-06-02" | null,
      "idle_days": 130 }               // days since the last sale; null = never sold
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
const { loadStockSplit } = require('../utils/stockSitting');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const split = await loadStockSplit();
    return res.json({ return_code: 'SUCCESS', ...split });
  } catch (err) {
    logger.error('[analytics-stock-sitting] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sitting stock' });
  }
});

module.exports = router;
