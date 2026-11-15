/*
=======================================================================================================================================
API Route: analytics_stock_ladder
=======================================================================================================================================
Method: GET
Purpose: THE STOCK LADDER's front figures (owner, 2026-11-15; design docs/stock-ladder.md) — every SKU we hold on exactly one of five
         steps (Arrived · Sold 90 · Unsold 90 · Unsold 180 · Clearance), with the Overstocked label on step 2. Drawn on Range's front
         screen (/analytics/slow-sizes). Counts only for now: the lists per step come later (owner: "No lists or drill down yet").
         Rules: utils/stockLadder.js (THE copy) — read its header.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-11-15",
  "held": { "skus": 1039, "units": 2907 },             // every SKU we hold stock of (local + FBA)
  "steps": [                                            // always all five, in step order; they add up to held
    { "step": 1, "key": "arrived", "skus": 125, "units": 210 },
    …
    { "step": 5, "key": "clearance", "skus": 166, "units": 480 }
  ],
  "overstocked": { "skus": 41, "units": 410, "over": 230 },   // step 2 SKUs only (inside step 2's count);
                                                              // units = all they hold, over = pairs beyond 4 months' worth
  "rule": { "over_cover_days": 122 }
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
const { STEPS, OVER_COVER_DAYS, readStockLadder } = require('../utils/stockLadder');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { today, skus } = await readStockLadder();
    const steps = STEPS.map((s) => ({ ...s, skus: 0, units: 0 }));
    const overstocked = { skus: 0, units: 0, over: 0 };
    let units = 0;
    for (const x of skus) {
      const s = steps.at(x.step - 1);
      s.skus += 1;
      s.units += x.units;
      units += x.units;
      if (x.overstocked) {
        overstocked.skus += 1;
        overstocked.units += x.units;
        overstocked.over += x.over;
      }
    }
    return res.json({ return_code: 'SUCCESS', today, held: { skus: skus.length, units }, steps, overstocked,
      rule: { over_cover_days: OVER_COVER_DAYS } });
  } catch (err) {
    logger.error('[analytics-stock-ladder] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the stock ladder' });
  }
});

module.exports = router;
