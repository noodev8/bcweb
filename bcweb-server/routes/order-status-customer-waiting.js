/*
=======================================================================================================================================
API Route: order_status_customer_waiting
=======================================================================================================================================
Method: POST
Purpose: Mark a customer order as WAITING, or clear it — `orderstatus.customerwaiting`. The legacy Status screen's yellow row: an order
         we know cannot be fulfilled yet and have (usually) told the customer about, so it should stop reading as an unhandled problem
         every time someone scans the list.

WHY IT MATTERS: without it, a line with no stock anywhere is indistinguishable from a line nobody has looked at. Waiting is the
operator saying "I know, it's handled, stop shouting". That is the entire value of the flag, and it is why the screen ranks `no_stock`
ABOVE `waiting` in its state priority (utils/customerOrders.js) — the unacknowledged problem must outrank the acknowledged one.

EXPLICIT VALUE, NOT A TOGGLE. The legacy code read the clicked row's current value and flipped it (apply-status-change.txt lines
41-52). That races: two operators on the same order, or a double-click against a stale list, and the flag ends up the opposite of what
either intended. The client sends the value it wants instead, so the write is idempotent.

GRAIN: per ORDER — every line sharing the ordernum. An order is either held or it isn't; flagging one pair of a two-pair order as
waiting while the other reads normal would show the order in two states at once.

NOTE ON REACH: nothing downstream consumes `customerwaiting`. Neither utils/orderSync.js nor update_orders.py reads it — phase E will
still try to source a waiting line on the next run, exactly as it did under PowerBuilder. This flag is a signal to the humans reading
the screen, and changing that would mean changing the sync in both places at once (see the banner in utils/orderSync.js).
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665", "waiting": true }

Success Response:
{ "return_code": "SUCCESS", "updated": 2, "waiting": true }
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
// Shared date-format constant only — see the note in order-status-customer-note.js.
const { LEGACY_STAMP } = require('../utils/orderStatus');
const { CUSTOMER_ORDERTYPE } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const { ordernum, waiting } = req.body || {};

    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    if (typeof waiting !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'waiting must be true or false' });
    }

    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE orderstatus
            SET customerwaiting = $1, updated = ${LEGACY_STAMP}
          WHERE ordernum = $2 AND ordertype = $3`,
        [waiting ? 1 : 0, ordernum.trim(), CUSTOMER_ORDERTYPE]
      );
      return r.rowCount || 0;
    });

    if (updated === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }

    return res.json({ return_code: 'SUCCESS', updated, waiting });
  } catch (err) {
    logger.error('[order-status-customer-waiting] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update the waiting flag' });
  }
});

module.exports = router;
