/*
=======================================================================================================================================
API Route: portfolio_status
=======================================================================================================================================
Method: GET
Purpose: Winners screen (since 2026-09-24) — everything it draws, from the STORED portfolio status tags and nothing live.

         "Instead of determining the WINNERS all the time, lets tag it in the database." — owner, 2026-09-24. Every style carries
         skusummary.portfolio_status (WINNERS | STEADY | NEW | HARVEST | LOSERS), set by "Update now" (POST /portfolio-snapshot-
         update). This route only READS: the counts, the tagged winners with the revenue/units stamped beside the tag, the bar
         ladder the screen's dial offers, and the recorded status trend. The rules live in utils/portfolioStatus.js.

         THE DIAL IS A READING WITHIN THE TAG. The owner kept the £1,500 / £2,500 / £5,000 / £10,000 toggle "just for screen
         reporting". It filters the tagged WINNERS on their STAMPED revenue, so at £1,500 it shows exactly the tag count and at
         higher bars a subset. It never re-tags and never reaches the database — the tag is always the £1,500 test.

         Replaced GET /portfolio-winners as the screen's source (2026-09-24). That route — a live count that included deleted
         styles, so it could disagree with the tag — and its portfolio_snapshot trend were removed on 2026-09-25. The Reports → New
         strip reads this route too, so every "winners" number in the app is the tag.

Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional integer >= 1 — trailing window of recorded status history (default 365, cap 730 = the retention).

Success Response:
{
  "return_code": "SUCCESS",
  "days": 365,
  "status": {
    "total": 305,                        // every style in skusummary; the five counts (+ untagged) sum to it
    "updated_at": "2026-09-24 22:17",    // London time of the last Update; null = never run
    "added_since": 0,                    // created since that Update (NEW, not yet assessed)
    "untagged": 0,
    "statuses": [ { "status": "WINNERS", "count": 73, "pct": 23.9 }, ... ]   // always five, rule order
  },
  "bars": [1500, 2500, 5000, 10000],     // the dial; bars[0] is the tag's own bar (WINNER_BAR)
  "winners": [                           // the tagged WINNERS, stamped revenue descending
    { "groupid": "0051753", "title": "…", "brand": "Birkenstock", "revenue_12m": 21480.5, "units_12m": 540 }, ...
  ],
  "history": [                           // one row per Update day, oldest first. Starts 2026-09-24 — never backfilled
    { "date": "2026-09-24", "WINNERS": 73, "STEADY": 175, "NEW": 22, "HARVEST": 15, "LOSERS": 20, "total": 305 }
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
const { WINNER_BAR_LADDER } = require('../utils/portfolio');
const { readPortfolioStatus, readTaggedWinners, readStatusHistory } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const DEFAULT_HISTORY_DAYS = 365;
const MAX_HISTORY_DAYS = 730;   // matches the 2-year prune in recordStatusSnapshot

router.get('/', async (req, res) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days) || days < 1) days = DEFAULT_HISTORY_DAYS;
    if (days > MAX_HISTORY_DAYS) days = MAX_HISTORY_DAYS;

    // Three independent reads of stored data — run together.
    const [status, winners, history] = await Promise.all([
      readPortfolioStatus(),
      readTaggedWinners(),
      readStatusHistory(days),
    ]);

    return res.json({ return_code: 'SUCCESS', days, status, bars: WINNER_BAR_LADDER, winners, history });
  } catch (err) {
    logger.error('[portfolio-status] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load portfolio status' });
  }
});

module.exports = router;
