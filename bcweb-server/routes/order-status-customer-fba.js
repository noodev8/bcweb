/*
=======================================================================================================================================
API Route: order_status_customer_fba
=======================================================================================================================================
Method: POST
Purpose: Re-route a customer order line to Amazon FBA — the legacy "Order FBA" action (apply-status-change.txt lines 105-173). Releases
         whatever shelf stock was picked for it, then flags the line as coming from FBA instead so the order is fulfilled from Amazon.

WHEN IT'S USED: the shelf pick turned out to be wrong, damaged, or not actually there, and the same SKU is sitting in FBA. Rather than
chase the shelf, the line is handed to Amazon.

PORTED FAITHFULLY, INCLUDING THE FLAG WRITES. The legacy action sets six columns this app never reads — pickedqty, notorderamz,
alloworder, picknotfound, fbaordered — because PowerBuilder DOES read them and both apps are live in parallel until this screen is
trusted. A bcweb-flagged line must be indistinguishable from a PowerBuilder-flagged one, so the writes are reproduced exactly rather
than trimmed to what bcweb alone would need. Revisit when the legacy screen is retired.

THE ONE COLUMN THAT ACTUALLY DOES SOMETHING is `amz`. utils/orderSync.js phase E (and its twin, update_orders.py) only considers lines
where all four sourcing flags are zero, so setting amz > 0 permanently removes the line from the sync's candidate set.

  !! THIS IS ONE-WAY. !! The legacy undo was "Reset", which was deliberately NOT ported (owner's call — it was never used, and its
  stock handling needs the wider stock-process review first). Once a line is flagged FBA, nothing in bcweb puts it back: the sync will
  never re-sweep it. The remaining routes out are the legacy Reset button, or Delete + let the next sync re-insert the line from
  Shopify. Say so in the UI before firing this.

SINGLE-LINE ORDERS ONLY, exactly as the legacy guarded it ("Cannot order an FBA group"). A multi-line order would need its lines
sourced independently — some from the shelf, some from FBA — and the legacy write had no way to express that, so it refused rather
than half-doing it. Kept: this is a port, and loosening a guard whose reasoning we're inferring is how ports go wrong.

STOCK: releasing the pick sets `localstock.ordernum` back to '#FREE' so the unit returns to the pick pool. This is a real stock write
and it is the one the legacy action performs — note it does NOT carry the `qty = 0` step that legacy "Reset" had, which was destroying
shelf units via the phase-D cleanup. `allocated` is deliberately left alone (phase E requires 'unallocated' to re-pick, which is what a
released pick already is).
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665" }

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC18665", "code": "0034791-MILANO-44", "picksReleased": 1, "fba": 1 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"FBA_GROUP"          — the order has more than one line; the legacy guard refuses these
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
    const { ordernum } = req.body || {};
    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    const num = ordernum.trim();

    const outcome = await withTransaction(async (client) => {
      // FOR UPDATE holds the line for the duration: the group-size check below is only meaningful if nothing can add a line to the
      // order between reading it and writing.
      const lines = await client.query(
        `SELECT shopifysku, COALESCE(qty, 1) AS qty
           FROM orderstatus
          WHERE ordernum = $1 AND ordertype = $2
          FOR UPDATE`,
        [num, CUSTOMER_ORDERTYPE]
      );

      if (lines.rows.length === 0) return { code: 'NOT_FOUND' };
      if (lines.rows.length > 1) return { code: 'FBA_GROUP', lines: lines.rows.length };

      const { shopifysku, qty } = lines.rows[0];
      const units = Number(qty) || 1;

      // Release the shelf pick(s) back to the free pool. localstock.updated is character varying holding the legacy text stamp
      // (the bulk of the table is in that format), so LEGACY_STAMP is what belongs here.
      const released = await client.query(
        `UPDATE localstock
            SET ordernum = '#FREE', updated = ${LEGACY_STAMP}
          WHERE ordernum = $1 AND code = $2 AND COALESCE(deleted, 0) <> 1`,
        [num, shopifysku]
      );

      // The legacy write, column for column. orderdate is blanked because for a customer order it IS the "allocated" stamp
      // (utils/customerOrders.js) — leaving it set would show an FBA line as still reserved on the shelf.
      await client.query(
        `UPDATE orderstatus
            SET orderdate = '', pickedqty = 0, localstock = 0, ukd = 0, othersupplier = 0,
                amz = $1, notorderamz = 0, alloworder = 1, picknotfound = 0, fbaordered = '',
                updated = ${LEGACY_STAMP}
          WHERE ordernum = $2 AND ordertype = $3`,
        [units, num, CUSTOMER_ORDERTYPE]
      );

      return { code: 'SUCCESS', shopifysku, units, picksReleased: released.rowCount || 0 };
    });

    if (outcome.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }
    if (outcome.code === 'FBA_GROUP') {
      return res.json({
        return_code: 'FBA_GROUP',
        message: `This order has ${outcome.lines} lines — FBA can only be set on a single-line order`,
      });
    }

    return res.json({
      return_code: 'SUCCESS',
      ordernum: num,
      code: outcome.shopifysku,
      picksReleased: outcome.picksReleased,
      fba: outcome.units,
    });
  } catch (err) {
    logger.error('[order-status-customer-fba] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to flag the order for FBA' });
  }
});

module.exports = router;
