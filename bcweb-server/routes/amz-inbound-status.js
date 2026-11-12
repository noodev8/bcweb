/*
=======================================================================================================================================
API Route: amz_inbound_status
=======================================================================================================================================
Method: GET
Purpose: Where "Do shipment" is (utils/amzInbound.js). READ ONLY, nothing goes to Amazon. The screen polls it while a run is going.
         Held in the server's memory only: after a restart it's empty (job null), and the next press starts clean anyway.

Success Response:
{ "return_code": "SUCCESS",
  "job": null | { "id": 3, "by": "Andreas", "startedAt": "…", "finishedAt": "…" | null,
                  "state": "running" | "done" | "stopped" | "failed", "step": "Sending 14 boxes",
                  "log": [ { "at": "…", "text": "…" } ], "warnings": [ "…" ], "message": "…" | null,
                  "totals": { "boxes": 14, "units": 212 },
                  "result": null | { "planId": "wf…", "boxes": 14, "units": 212, "skus": 131, "sellerPrep": 4, "sellerCentral": "https://…" } } }
=======================================================================================================================================
Return Codes: "SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const inbound = require('../utils/amzInbound');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', (req, res) => {
  try {
    return res.json({ return_code: 'SUCCESS', job: inbound.status() });
  } catch (err) {
    logger.error('[amz-inbound-status] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to read Do shipment' });
  }
});

module.exports = router;
