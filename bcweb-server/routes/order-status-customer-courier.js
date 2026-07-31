/*
=======================================================================================================================================
API Route: order_status_customer_courier
=======================================================================================================================================
Method: POST
Purpose: Override the shipping service on a customer order — `orderstatus.courier`, plus the `courierfixed` lock the legacy screen set
         alongside it (apply-status-change.txt lines 283-317).

WHY AN OVERRIDE EXISTS: courier is normally DERIVED, not chosen. update_orders.py:531 sets it at insert time from what the customer
paid at checkout — `courier = str(4 if shipping_cost == 5.95 else 5)` — so the default is right almost always. This route is for the
exceptions: a heavy or bulky order that needs a different service, or one being collected rather than posted.

THE THREE CODES, and why not five. Across 3,177 archived customer rows only three values ever appear: '5' Royal Mail 48 (2,811),
'4' Royal Mail 24 (356), '0' pack only (20). The legacy dropdown also offered '2' DHL and '3' DPD; neither has been used once, and
both were dropped from this module (owner's call). The whitelist lives in utils/customerOrders.js so the server and the UI can't drift
about what is offerable — and the server validates against it rather than trusting the client, because an unrecognised code would sit
in the column looking legitimate and silently mis-route an order.

CODES ARE STRINGS. `courier` is character varying and '0' (pack only) is a real, meaningful value — treating these as numbers loses it
to the first falsy test that touches it.

WHY courierfixed IS STILL WRITTEN, even though we dropped "Unlock Courier". Nothing in the ported pipeline reads it: courier is set at
INSERT only and never recomputed, so the "don't overwrite my choice" lock currently guards nothing. But PowerBuilder is still live and
still reads and clears it, and we run both apps in parallel until this screen is trusted. Writing it costs one column and keeps a
bcweb-set courier indistinguishable from a PowerBuilder-set one; NOT writing it would diverge the two apps for no gain. Revisit when
the legacy screen is retired, not before.

GRAIN: per ORDER — one parcel, one service. Setting it per line would be meaningless.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665", "courier": "4" }    // one of '0' | '4' | '5'

Success Response:
{ "return_code": "SUCCESS", "updated": 2, "courier": "4" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_COURIER"
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
const { CUSTOMER_ORDERTYPE, COURIER_CODES } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const { ordernum, courier } = req.body || {};

    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    // String(courier) rather than a typeof guard: a client that sends the code as a JSON number still means the same service, and
    // rejecting that would be pedantry. The whitelist below is what actually protects the column.
    const code = String(courier ?? '').trim();
    if (!COURIER_CODES.includes(code)) {
      return res.json({ return_code: 'INVALID_COURIER', message: `courier must be one of ${COURIER_CODES.join(', ')}` });
    }

    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE orderstatus
            SET courier = $1, courierfixed = 1, updated = ${LEGACY_STAMP}
          WHERE ordernum = $2 AND ordertype = $3`,
        [code, ordernum.trim(), CUSTOMER_ORDERTYPE]
      );
      return r.rowCount || 0;
    });

    if (updated === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }

    return res.json({ return_code: 'SUCCESS', updated, courier: code });
  } catch (err) {
    logger.error('[order-status-customer-courier] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set the courier' });
  }
});

module.exports = router;
