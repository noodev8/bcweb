/*
=======================================================================================================================================
API Route: order_status_customer_reset
=======================================================================================================================================
Method: POST
Purpose: The order box's Reset (owner, 2026-10-22: "give me a button to reset orders ... i dont want to order from amz so i want to
         reset it to get rid of the order for fba"). Puts a customer order back to how the order sync first inserts it, so the next
         Update orders sorts it again from scratch.

BACK TO NEW, NOT "NEVER FBA" (owner's choice, 2026-10-22). Every sourcing flag is cleared — amz, localstock, ukd, othersupplier — and
orderdate is blanked (the FBA "file made" stamp, the shelf-allocated stamp and Do not order all live there). That puts the line back
in utils/orderSync.js phase E's candidate set (and update_orders.py's, its cron twin), which sorts it shelf → Amazon FBA → supplier.
So an order with nothing on the shelf and stock at Amazon goes back to FBA at the next Update orders — the owner knows; nothing here
stops it. A "don't use Amazon" rule would have to go into BOTH syncs.

STOCK: any shelf pick held for the order is released to '#FREE', the same release order-status-customer-fba does (no `qty = 0` — that
legacy Reset step destroyed shelf units via the phase-D cleanup).

THE FLAG COLUMNS go back to a new row's values (orderSync's NEW ROW insert): pickedqty 0, notorderamz/alloworder/picknotfound/
fbaordered NULL. Notes, courier, Waiting and the customer details are kept — they're decisions or facts, not sourcing.

REFUSED WHEN PACKED with a label (batch '2'): the Click & Drop label exists and would be orphaned. Cancel the label first (that
un-packs it), then Reset.

NOT UNDONE AT AMAZON: if the Amazon MCF file was made AND uploaded, the order is already with Amazon — clearing the stamp here doesn't
cancel it in Seller Central. The confirm just asks "Reset to new?" (owner, 2026-10-22: no Amazon warning).
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC19359" }

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC19359", "lines": 1, "picksReleased": 0 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"PACKED"             — a line is packed (batch '2'); cancel the label first
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LEGACY_STAMP } = require('../utils/orderStatus');
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

    const outcome = await withTransaction(async (client) => {
      const lines = await client.query(
        `SELECT shopifysku, batch FROM orderstatus WHERE ordernum = $1 AND ordertype = $2 FOR UPDATE`,
        [num, CUSTOMER_ORDERTYPE]
      );
      if (lines.rows.length === 0) return { code: 'NOT_FOUND' };
      if (lines.rows.some((l) => String(l.batch || '').trim() === '2')) return { code: 'PACKED' };

      // Every shelf pick held for the order, whichever of its lines it was taken for.
      const released = await client.query(
        `UPDATE localstock
            SET ordernum = '#FREE', updated = ${LEGACY_STAMP}
          WHERE ordernum = $1 AND COALESCE(deleted, 0) <> 1`,
        [num]
      );

      await client.query(
        `UPDATE orderstatus
            SET orderdate = '', pickedqty = 0, localstock = 0, ukd = 0, othersupplier = 0, amz = 0,
                notorderamz = NULL, alloworder = NULL, picknotfound = NULL, fbaordered = NULL,
                updated = ${LEGACY_STAMP}
          WHERE ordernum = $1 AND ordertype = $2`,
        [num, CUSTOMER_ORDERTYPE]
      );

      return { code: 'SUCCESS', lines: lines.rows.length, picksReleased: released.rowCount || 0 };
    });

    if (outcome.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }
    if (outcome.code === 'PACKED') {
      return res.json({ return_code: 'PACKED', message: 'This order is packed with a label — cancel the label first, then reset' });
    }
    return res.json({ return_code: 'SUCCESS', ordernum: num, lines: outcome.lines, picksReleased: outcome.picksReleased });
  } catch (err) {
    logger.error('[order-status-customer-reset] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to reset the order' });
  }
});

module.exports = router;
