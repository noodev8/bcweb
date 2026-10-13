/*
=======================================================================================================================================
API Route: order_status_customer_label_cancel
=======================================================================================================================================
Method: POST
Purpose: "Cancel label" on Customer Orders — a label printed by mistake. Deletes the order's shipment in Click & Drop (found by
         ordernum, utils/clickDrop.js — nothing about it is stored in bcweb) and takes the order back out of PACKED (batch '2' -> '0',
         weight cleared), so it can be scanned and labelled again.

ORDER OF WORK: Click & Drop first, then our rows. Royal Mail refuses to delete an order once it's MANIFESTED (handed over for
collection); that refusal comes back as CLICKDROP_ERROR and our rows are left alone, because the parcel really is on its way. Only a
successful delete un-packs the order.

NO C&D ORDER (e.g. packed by hand in PowerBuilder): NO_LABEL, and nothing changes — there's no label to cancel, and un-packing an
order this screen didn't pack isn't this button's job.

The un-pack touches only lines at batch '2' — the lines the label packed. An FBA line done by its Amazon file stays done.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC19314" }

Success Response:
{ "return_code": "SUCCESS", "ordernum": "BC19314", "unpacked": 2 }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NO_LABEL" · "CLICKDROP_ERROR" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LEGACY_STAMP } = require('../utils/orderStatus');
const { CUSTOMER_ORDERTYPE } = require('../utils/customerOrders');
const clickDrop = require('../utils/clickDrop');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const ordernum = String(req.body?.ordernum || '').trim().toUpperCase();
  if (!ordernum) return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });

  try {
    const unpacked = await withTransaction(async (client) => {
      // Same lock as the label route, so a cancel can't interleave with a print of the same order.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`clickdrop:${ordernum}`]);

      const existing = await clickDrop.findByReference(ordernum);
      if (!existing) return null;
      await clickDrop.deleteOrder(existing.orderIdentifier);

      const r = await client.query(
        `UPDATE orderstatus
            SET batch = '0', weight = '', updated = ${LEGACY_STAMP}
          WHERE ordernum = $1 AND ordertype = $2 AND batch = '2'`,
        [ordernum, CUSTOMER_ORDERTYPE]
      );
      logger.info(`[order-status-customer-label-cancel] ${ordernum} C&D order ${existing.orderIdentifier} deleted by ${req.user.display_name}`);
      return r.rowCount || 0;
    });

    if (unpacked === null) return res.json({ return_code: 'NO_LABEL', message: `${ordernum} has no Click & Drop label to cancel` });
    return res.json({ return_code: 'SUCCESS', ordernum, unpacked });
  } catch (err) {
    if (err instanceof clickDrop.ClickDropError) {
      logger.error('[order-status-customer-label-cancel] Click & Drop:', err.message);
      return res.json({ return_code: 'CLICKDROP_ERROR', message: `Click & Drop: ${err.message}` });
    }
    logger.error('[order-status-customer-label-cancel] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to cancel the label' });
  }
});

module.exports = router;
