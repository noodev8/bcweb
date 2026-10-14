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

         ALSO TOPS UP THE SHOPIFY PAYMENTS FEES (owner, 2026-10-14: "top up when I press update on the winners page") — fee_daily,
         read by Reports → Revenue (utils/feeDaily.js) — AND the delivery customers paid per order (shopify_delivery,
         utils/shopifyDelivery.js). It runs after the re-tag commits and can't fail it: an error comes back in
         `fees` and the fees simply stay as they were until the next press. Usually one Shopify API page.

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
  },
  "fees": { "ok": true, "from": "2026-10-13", "to": "2026-10-14" }   // Shopify Payments fee top-up; { ok: false, error } if it failed
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
const { topUpShopifyFees } = require('../utils/feeDaily');
const { topUpDelivery } = require('../utils/shopifyDelivery');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const status = await withTransaction((client) => applyPortfolioStatus(client));

    // Then top up the Shopify Payments fees (see the header). AFTER the re-tag has committed and best-effort: a Shopify outage must
    // not fail or undo the re-tag, so a failure is logged and reported in `fees`, never thrown.
    // Delivery charged (shopify_delivery) is topped up the same way, and reported in the same `fees` block — one message on screen.
    let fees;
    try {
      const f = await topUpShopifyFees();
      await topUpDelivery();
      fees = { ok: true, from: f.from, to: f.to };
    } catch (e) {
      logger.error('[portfolio-snapshot-update] fee / delivery top-up failed:', e.message);
      fees = { ok: false, error: e.message };
    }

    return res.json({ return_code: 'SUCCESS', status, fees });
  } catch (err) {
    logger.error('[portfolio-snapshot-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update portfolio status' });
  }
});

module.exports = router;
