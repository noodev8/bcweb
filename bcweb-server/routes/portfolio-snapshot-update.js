/*
=======================================================================================================================================
API Route: portfolio_snapshot_update
=======================================================================================================================================
Method: POST
Purpose: Winners screen — the "Update now" button. RE-TAGS every style's portfolio status (skusummary.portfolio_status: WINNERS |
         STEADY | NEW | HARVEST | LOSERS, plus the lead channel and the stamped 12m revenue/units — the rules are in
         utils/portfolioStatus.js) and records today's five counts as a point on the status trend (portfolio_status_snapshot).
         The owner asked for one button, not two: "when pressed, the latest tag is set".

         MANUAL TRIGGER ONLY — no cron. Viewing the screen (GET /portfolio-status) reads stored data and writes nothing, so merely
         opening the page never appends a point. Recording one is a deliberate press. Same read/update split as Stock Position and
         Birk Availability, and for the same reason: a series that grew on every page view would be a record of browsing habits,
         not of the business.

WHAT A SNAPSHOT MEANS, AND WHY IT IS NOT JUST A CACHE
         A stored point IS WHAT WE SAID ON THE DAY. A recomputation is what the books say NOW about then, and the two drift as
         late-booked sales, refunds and corrections land. Do not backfill the status trend to make the chart look fuller.

         Tag and trend point are written in ONE transaction, so a failed press leaves neither half written. The only product-table
         write is portfolio_status / _at / _channel / _revenue_12m / _units_12m — no legacy `updated` stamp, no shopifychange.

         Growth safeguard: snapshot_date is the PK and is UPSERTed (a second press in a day overwrites), and the writer prunes rows
         past 2 years in the same transaction. Max ~730 rows, permanently.

         URL KEEPS ITS OLD NAME. Until 2026-09-25 this also wrote a live winner count to `portfolio_snapshot`; that table, and the
         GET /portfolio-winners that drew it, were removed so the app has one winners ruler — the tag. Renaming the route would be
         churn for no behaviour change.

         Requires auth.
=======================================================================================================================================
Request Payload: none (POST)

Success Response:
{
  "return_code": "SUCCESS",
  "date": "2026-09-21",               // the row that was written, AS THE DB DATED IT (not this process's idea of today)
  "status": {                         // the tags just written to skusummary.portfolio_status, counted
    "counts": { "WINNERS": 73, "STEADY": 175, "NEW": 22, "HARVEST": 15, "LOSERS": 20 },
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
const { applyPortfolioStatus, recordStatusSnapshot } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// ⚠ THE DB AND THIS PROCESS DISAGREE ABOUT WHAT DAY IT IS, FOR ONE HOUR A NIGHT THROUGH BST.
//   The Postgres session runs Etc/UTC while the box runs Europe/London, so between midnight BST and midnight UTC, CURRENT_DATE is
//   still yesterday while `new Date()` here has already rolled over. The date reported is the one the DATABASE stamped on the row,
//   read back via RETURNING. Never reintroduce a JS-side "today" here.

router.post('/', async (req, res) => {
  try {
    const written = await withTransaction(async (client) => {
      const status = await applyPortfolioStatus(client);
      const date = await recordStatusSnapshot(client, status);
      return { date, status };
    });

    return res.json({ return_code: 'SUCCESS', date: written.date, status: written.status });
  } catch (err) {
    logger.error('[portfolio-snapshot-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update portfolio status' });
  }
});

module.exports = router;
