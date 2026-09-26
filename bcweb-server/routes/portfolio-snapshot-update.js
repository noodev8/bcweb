/*
=======================================================================================================================================
API Route: portfolio_snapshot_update
=======================================================================================================================================
Method: POST
Purpose: Repricing Status tab — the "Update now" button (also offered by Back Office → Seasons after a season change). RE-TAGS every
         style's portfolio status (skusummary.portfolio_status: WINNERS | STEADY | NEW | LOSERS, plus the lead channel and
         the stamped 12m revenue/units — the rules are in utils/portfolioStatus.js), in one transaction.

         MANUAL TRIGGER ONLY — no cron. Viewing a screen reads the stored tags and writes nothing.

         THE STATUS TREND WAS REMOVED 2026-09-25 (owner). Until then this also recorded the day's counts in
         portfolio_status_snapshot for a graph on the Status tab. While a WINNER had to be in season (2026-09-25..26), WINNERS and the
         since-retired HARVEST swung by design every 1 April and 1 September, and every Seasons review moved them too — the line would
         have charted the rules, the calendar and our own edits, not the business. Graph, table writes and reads all went; git history
         has them.

         The only product-table write is portfolio_status / _at / _channel / _revenue_12m / _units_12m — no legacy `updated` stamp,
         no shopifychange.

         URL KEEPS ITS OLD NAME ("snapshot") — renaming it would be churn for no behaviour change.

         Requires auth.
=======================================================================================================================================
Request Payload: none (POST)

Success Response:
{
  "return_code": "SUCCESS",
  "status": {                         // the tags just written to skusummary.portfolio_status, counted
    "counts": { "WINNERS": 63, "STEADY": 181, "NEW": 22, "LOSERS": 39 },
    "total": 305
  }
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
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { applyPortfolioStatus } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const status = await withTransaction((client) => applyPortfolioStatus(client));

    return res.json({ return_code: 'SUCCESS', status });
  } catch (err) {
    logger.error('[portfolio-snapshot-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update portfolio status' });
  }
});

module.exports = router;
