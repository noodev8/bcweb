/*
=======================================================================================================================================
API Route: analytics_sell_through
=======================================================================================================================================
Method: GET
Purpose: Reports -> Sell-through. Units only — "We bought it, we sell it. How many have we got and are we getting through them"
         (owner, 2026-10-14). The owner's target: push the excess unit count down, then grow profit while total stock grows at a
         healthy pace — and see over time whether those decisions are working.

         Everything comes from utils/unitAge.js (the unit ledger: FIFO-dated pairs, nothing stored — rules and the why are there):
           recent   today / 7 / 30 / 90 days: pairs in (Goods In) and pairs out (sales, net of returns)
           months   rolling 24 months (from Jan 2025 until then): in, sold, profit, pairs held at month end split by age band
           cohorts  each arrival month: pairs in, and how many were still held 3 and 6 month-ends later, and now
           styles   every style held now, its pairs by age band, oldest-heavy first

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-14",
  "recent": { "d1": { "in": 0, "sold": 7 }, "d7": {...}, "d30": {...}, "d90": {...} },
  "months": [ { "month": "2026-09", "end": "2026-09-30", "partial": false, "in": 446, "sold": 437, "profit": 2793, "held": 3029,
                "bands": { "m0_3": 1334, "m3_6": 1180, "m6_12": 141, "m12": 274, "pre": 100 } }, ... ],   // oldest -> newest
  "cohorts": [ { "month": "2026-04", "in": 1627, "left_3m": 214, "left_6m": null, "left_now": 115 }, ... ],
  "styles": [ { "groupid", "title", "brand", "units", "bands": {...}, "oldest": "2025-04-14" | null, "sold_90": 6 }, ... ]
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
const logger = require('../utils/logger');
const { loadUnitLedger } = require('../utils/unitAge');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const d = await loadUnitLedger();
    return res.json({ return_code: 'SUCCESS', ...d });
  } catch (err) {
    logger.error('[analytics-sell-through] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Sell-through' });
  }
});

module.exports = router;
