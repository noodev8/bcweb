/*
=======================================================================================================================================
API Route: amz_inbound_status
=======================================================================================================================================
Method: GET
Purpose: Where "Do shipment" is (utils/amzInbound.js). The screen polls it while a run is going. Nothing is written anywhere.
         Held in the server's memory only. After a restart the FIRST read asks Amazon (GET calls only) whether the stored boxes are
         already booked, so the booked notice, Reprint labels and the box freeze come back by themselves (amzInbound.recover).

Success Response:
{ "return_code": "SUCCESS",
  "job": null | { "id": 3, "by": "Andreas", "startedAt": "…", "finishedAt": "…" | null,
                  "state": "running" | "confirm" | "done" | "stopped" | "failed", "step": "Sending 14 boxes",
                  "log": [ { "at": "…", "text": "…" } ], "warnings": [ "…" ], "message": "…" | null, "sellerCentral"?: "https://…",
                  "totals": { "boxes": 14, "units": 212 },
                  "confirm": null | { "warehouse": "CWL1", "town": "Swansea", "fee": 0, "fees": [ { "text": "…", "amount": 0, "currency": "GBP" } ],
                                      "expires": "…" | null, "skus": 131, "sellerPrep": 4, "today": "2026-11-13" },
                  "result": null | { "planId": "wf…", "shipmentId": "sh…", "fba": "FBA15…", "warehouse": "CWL1", "town": "Swansea",
                                     "carrierSet": true, "window": { "start": "2026-11-14", "end": "2026-11-20" } | null,
                                     "readyDate"?: "2026-11-14", "boxes": 14, "units": 212, "already": false, "sellerCentral": "https://…" } } }
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

router.get('/', async (req, res) => {
  try {
    await inbound.recover(); // once per process; a no-op afterwards
    return res.json({ return_code: 'SUCCESS', job: inbound.status() });
  } catch (err) {
    logger.error('[amz-inbound-status] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to read Do shipment' });
  }
});

module.exports = router;
