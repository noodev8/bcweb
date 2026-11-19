/*
=======================================================================================================================================
API Route: amz_dpd_label
=======================================================================================================================================
Method: GET
Purpose: The DPD labels of the Amazon shipment booked by Book DPD (POST /amz-dpd-book), as DPD's raw printer commands, for the DPD
         printer (the TSC DA200 — NEVER the Zebra, owner 2026-11-19). READ ONLY. The screen sends them to that printer through QZ Tray
         (raw) and saves a copy to Downloads. DPD's label for parcel n goes on box n.
         Only for a booking made since the server last started: after a restart there's no DPD shipment id to ask for, so → NOT_FOUND
         (reprint from MyDPD).

Query: ?format=epl | clp   (default epl — Eltron EPL; Citizen CLP the alternative. DPD's HTML is A4 only and fails sign-off on thermal.)
Success Response: { "return_code": "SUCCESS", "data": "<base64 printer commands>", "format": "epl", "consignment": "6813151615",
                    "parcels": 6, "fba": "FBA15…" }
=======================================================================================================================================
Return Codes: "SUCCESS" · "NOT_FOUND" · "BAD_FORMAT" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const format = String(req.query.format || 'epl');
    if (format !== 'epl' && format !== 'clp') return res.json({ return_code: 'BAD_FORMAT', message: 'Format is epl or clp' });
    const r = await inbound.dpdLabel({ format });
    if (r.none) return res.json({ return_code: 'NOT_FOUND', message: 'No DPD booking since the server last started. Reprint the labels from MyDPD.' });
    return res.json({ return_code: 'SUCCESS', data: r.data, format, consignment: r.consignment, parcels: r.parcels, fba: r.fba });
  } catch (err) {
    logger.error('[amz-dpd-label] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: `Couldn’t get the DPD labels: ${err.message}` });
  }
});

module.exports = router;
