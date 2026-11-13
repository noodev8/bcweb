/*
=======================================================================================================================================
API Route: amz_inbound_cancel
=======================================================================================================================================
Method: POST
Purpose: The confirm box's Cancel (Do shipment part 2, 2026-11-13). The run is waiting at the confirm box, nothing confirmed yet, so the
         plan is cancelled on Amazon (cancelInboundPlan — free before the placement confirm, proved by the test plan) and nothing is booked.
         A booked shipment is never cancelled from BCWEB (utils/amzInbound.js).

Request Body: { "id": 3 }
Success Response: { "return_code": "SUCCESS", "job": { ...see amz-inbound-status } }
=======================================================================================================================================
Return Codes: "SUCCESS" · "NOT_WAITING" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const inbound = require('../utils/amzInbound');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const r = await inbound.cancel({ id: req.body && req.body.id });
    if (r.error === 'NOT_WAITING') return res.json({ return_code: 'NOT_WAITING', message: 'Nothing is waiting to be confirmed' });
    logger.info(`[amz-inbound-cancel] job ${req.body.id} — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', job: r.job });
  } catch (err) {
    logger.error('[amz-inbound-cancel] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to cancel' });
  }
});

module.exports = router;
