/*
=======================================================================================================================================
API Route: order_status_customer_delete
=======================================================================================================================================
Method: POST
Purpose: Delete a customer order from `orderstatus` — the legacy "Remove" action (apply-status-change.txt lines 324-328), renamed to
         Delete because that is what the operators call it.

THE WORKFLOW THIS SERVES: the order is wrong in some way, so it gets sorted out in Shopify and deleted here. The next sync re-inserts
it from Shopify with the corrected details and phase E re-sources it from scratch. Deleting is how you ask for that re-read — it is a
refresh, not a cancellation. The row coming back is the POINT, not a side effect.

GRAIN — PER ORDER, every line sharing the ordernum, which is what the legacy loop did (its `IF ls_currentorder = ls_ordernum` gate
meant Remove took the whole order, not just the clicked row).

PORTED AS-IS: A PLAIN DELETE. NO ARCHIVE, NO STOCK RELEASE.
=======================================================================================================================================
  This is a faithful port, chosen deliberately (owner's call) over the "safer" variants, on the grounds that the wider stock-management
  process needs reviewing as a whole rather than one screen quietly diverging from the legacy behaviour while both apps run live. Two
  consequences are known and accepted for now; they are recorded here so the stock review has them:

  1. IF THE LINE WAS HOLDING A SHELF PICK, THE NEXT SYNC DESTROYS THAT UNIT. utils/orderSync.js phase D runs whenever phase C archived
     anything (i.e. most runs) and executes:

         DELETE FROM localstock
          WHERE ordernum LIKE 'BC%' AND ordernum NOT IN (SELECT DISTINCT ordernum FROM orderstatus)

     Its assumption is "a pick whose order row has gone was packed and posted". A deleted-but-unpicked order breaks that assumption,
     and the shelf unit is removed as though it had shipped. This is CURRENT LIVE BEHAVIOUR of the legacy Remove button, not something
     this route introduces — but it is now written down. The fix, when the stock process is reviewed, is one UPDATE releasing the pick
     to '#FREE' before the delete.

  2. NO ARCHIVE COPY. Unlike routes/order-status-archive.js (supplier orders), nothing is written to `orderstatus_archive`, so the
     line leaves no trail. Acceptable here only because the order still exists in Shopify and returns on the next sync.
=======================================================================================================================================

Scoped to ordertype = 1 in the WHERE clause, so this route can never delete a supplier order even if handed one — that is what
/order-status-archive is for, and it archives first.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665" }

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC18665", "deleted": 2 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { CUSTOMER_ORDERTYPE } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const { ordernum } = req.body || {};
    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    const num = ordernum.trim();

    const deleted = await withTransaction(async (client) => {
      const r = await client.query(
        `DELETE FROM orderstatus WHERE ordernum = $1 AND ordertype = $2`,
        [num, CUSTOMER_ORDERTYPE]
      );
      return r.rowCount || 0;
    });

    if (deleted === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }

    // Names the operator, which the generic utils/apiLogger.js line doesn't (it records only user#id). Worth having because this
    // action leaves no archive row. NOTE it rides at info level, so it is silenced under the production LOG_LEVEL=error along with
    // every other api log line — if a durable audit trail is ever wanted for deletes, that needs solving properly, not here.
    logger.info(`[order-status-customer-delete] ${req.user.display_name} deleted ${deleted} line(s) of ${num}`);

    return res.json({ return_code: 'SUCCESS', ordernum: num, deleted });
  } catch (err) {
    logger.error('[order-status-customer-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete the order' });
  }
});

module.exports = router;
