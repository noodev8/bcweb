/*
=======================================================================================================================================
API Route: amz_inbound_labels
=======================================================================================================================================
Method: GET
Purpose: The Amazon box labels of the booked shipment (Do shipment part 2, 2026-11-13), for the Zebra. READ ONLY on Amazon (GET calls).
         One PDF, one 4 × 6 thermal page per box, U000001 first — the same file Seller Central prints (v0 getLabels, PackageLabel_Thermal,
         UNIQUE, the shipment's box ids; read on a real shipment 2026-11-13). Printed straight after Confirm, and by Reprint labels any
         time until Mark shipped. The screen sends it to the Zebra through QZ Tray (src/lib/printPdf.ts).

Success Response: { "return_code": "SUCCESS", "pdf": "<base64>", "fba": "FBA15…", "boxes": 14 }
=======================================================================================================================================
Return Codes: "SUCCESS" · "NOT_BOOKED" (no booked shipment for the stored boxes) · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const r = await inbound.labels();
    if (r.none) return res.json({ return_code: 'NOT_BOOKED', message: 'There’s no booked Amazon shipment for these boxes' });
    return res.json({ return_code: 'SUCCESS', pdf: r.pdf, fba: r.fba, boxes: r.boxes });
  } catch (err) {
    logger.error('[amz-inbound-labels] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: `Couldn’t get the box labels: ${err.message}` });
  }
});

module.exports = router;
