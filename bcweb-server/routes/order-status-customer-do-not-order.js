/*
=======================================================================================================================================
API Route: order_status_customer_do_not_order
=======================================================================================================================================
Method: POST
Purpose: Mark a customer order DO NOT ORDER, or clear it — the legacy 'Do Not Order' text in `orderstatus.orderdate`, which PowerBuilder
         writes and which the screen reads as `parked` (utils/customerOrders.js rowState). Added back to bcweb 2026-10-15 (owner).

WHAT IT MEANS: don't SOURCE the line. Phase E's candidate filter (utils/orderSync.js allocatePicks, and update_orders.py — both live)
skips any line whose orderdate contains 'do not order', so nothing is reserved off a shelf or flagged to Amazon / UKD / another
supplier for it. It does NOT mean don't pack it (owner, 2026-10-15): a Do Not Order line scans and packs like any other.

GRAIN: per ORDER, like Waiting — every line of the ordernum that isn't already done. Skipped, so their own stamps survive:
  - packed lines (batch '2') — boxed, nothing left to source;
  - FBA lines whose Amazon file has been made (amz > 0 and orderdate stamped) — that stamp IS the "file made" record.

CLEARING puts orderdate back to what phase E would have left there: `created` on a line holding a shelf reservation (localstock > 0 —
phase E stamps orderdate = created when it allocates), '' otherwise, so an unsourced line becomes a phase E candidate again on the next
order sync. Only lines that actually read 'Do Not Order' are touched.

EXPLICIT VALUE, NOT A TOGGLE — same reason as order-status-customer-waiting.js: two operators on one order can't race to the opposite.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665", "doNotOrder": true }

Success Response:
{ "return_code": "SUCCESS", "updated": 2, "doNotOrder": true }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"            no open customer line on that order to change
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LEGACY_STAMP } = require('../utils/orderStatus');
const { CUSTOMER_ORDERTYPE, notDiscarded, parked } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

// The exact text PowerBuilder writes.
const DO_NOT_ORDER = 'Do Not Order';

router.post('/', async (req, res) => {
  try {
    const { ordernum, doNotOrder } = req.body || {};

    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    if (typeof doNotOrder !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'doNotOrder must be true or false' });
    }

    const updated = await withTransaction(async (client) => {
      const r = doNotOrder
        ? await client.query(
            `UPDATE orderstatus o
                SET orderdate = $1, updated = ${LEGACY_STAMP}
              WHERE o.ordernum = $2 AND o.ordertype = $3 AND ${notDiscarded('o')}
                AND COALESCE(o.batch, '') <> '2'
                AND NOT (COALESCE(o.amz, 0) > 0 AND COALESCE(o.orderdate, '') <> '' AND NOT ${parked('o')})`,
            [DO_NOT_ORDER, ordernum.trim(), CUSTOMER_ORDERTYPE]
          )
        : await client.query(
            `UPDATE orderstatus o
                SET orderdate = CASE WHEN COALESCE(o.localstock, 0) > 0 THEN o.created ELSE '' END, updated = ${LEGACY_STAMP}
              WHERE o.ordernum = $1 AND o.ordertype = $2 AND ${notDiscarded('o')} AND ${parked('o')}`,
            [ordernum.trim(), CUSTOMER_ORDERTYPE]
          );
      return r.rowCount || 0;
    });

    if (updated === 0) {
      return res.json({
        return_code: 'NOT_FOUND',
        message: doNotOrder ? 'No open lines on that order to mark' : 'That order isn’t marked Do Not Order',
      });
    }

    logger.info(`[order-status-customer-do-not-order] ${ordernum.trim()} ${doNotOrder ? 'marked' : 'cleared'} (${updated} lines) by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', updated, doNotOrder });
  } catch (err) {
    logger.error('[order-status-customer-do-not-order] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update Do Not Order' });
  }
});

module.exports = router;
