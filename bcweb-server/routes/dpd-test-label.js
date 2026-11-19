/*
=======================================================================================================================================
API Route: dpd_test_label   — TEMPORARY (owner, 2026-11-19: "add a temp button ... we will remove the button once we know it works")
=======================================================================================================================================
Method: POST
Purpose: The DPD label test from AMZ Shipment's temporary panel, run on a PC with the DPD printer. Two things to find out, and DPD's
         sign-off pack (docs/dpd/NOTES.md):
           1. does the TSC DA200 print DPD's raw label (EPL first, CLP if not)?
           2. are a 2-parcel consignment's labels numbered / ordered so that label n goes on box n?
         book: books a REAL consignment (DPD has no test environment; validated with ?test=true first) FROM our address TO our address,
               Parcel Next Day, ref "BCWEB LABEL TEST". Not charged unless a parcel enters the network: VOID IT IN MyDPD afterwards.
               Ignores DPD_LIVE — this test is the reason for a live booking. Answers with the label and the exact JSON sent (DPD wants
               both for sign-off).
         label: the label again for a shipment id this test booked (e.g. in the other format). Nothing booked.
         Remove this route, its line in server.js and the panel on the AMZ Shipment screen once the label is signed off.

Request Body: { "parcels": 2, "format": "epl" | "clp" }            // book (parcels 1–3)
              { "shipmentId": 1055223, "format": "clp" }            // label again
Success Response: { "return_code": "SUCCESS", "shipmentId": 1055223, "consignment": "6813151615", "parcels": ["15976…", …],
                    "request": { …the insert JSON sent… }, "label": "<base64 printer commands>", "format": "epl" }
=======================================================================================================================================
Return Codes: "SUCCESS" · "BAD_FORMAT" · "NOT_FOUND" (label for a shipment id this test didn't book) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const dpdApi = require('../utils/dpdApi');
const { logActivity } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

const booked = new Set(); // shipment ids this test booked since the server started — the only ones "label again" will fetch

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const format = String(b.format || 'epl');
    if (format !== 'epl' && format !== 'clp') return res.json({ return_code: 'BAD_FORMAT', message: 'Format is epl or clp' });

    if (b.shipmentId) {
      if (!booked.has(String(b.shipmentId))) return res.json({ return_code: 'NOT_FOUND', message: 'Not a test label booked here since the server started' });
      const buf = await dpdApi.label(b.shipmentId, format);
      return res.json({ return_code: 'SUCCESS', shipmentId: b.shipmentId, label: buf.toString('base64'), format });
    }

    const parcels = Math.min(3, Math.max(1, Math.round(Number(b.parcels) || 2)));
    const ours = dpdApi.collection();
    const r = await dpdApi.book({
      delivery: {
        organisation: ours.address.organisation, street: ours.address.street, locality: '', town: ours.address.town, county: '',
        postcode: ours.address.postcode, contactName: ours.contactDetails.contactName, telephone: ours.contactDetails.telephone,
      },
      parcels, totalKg: parcels, collectionDate: dpdApi.collectionDate(null), refs: ['BCWEB LABEL TEST'],
    }, { live: true });
    booked.add(String(r.shipmentId));
    logActivity({ who: req.user.display_name, section: 'AMZ Shipment', log: `DPD label TEST booked (void in MyDPD): consignment ${r.consignment}, ${r.parcels.length} parcels (${r.parcels.join(', ')}), shipment ${r.shipmentId}` });
    logger.info(`[dpd-test-label] booked ${r.consignment} (${r.shipmentId}) — by ${req.user.display_name}`);
    let label = null;
    let labelError = null;
    try { label = (await dpdApi.label(r.shipmentId, format)).toString('base64'); } catch (e) { labelError = e.message; }
    return res.json({
      return_code: 'SUCCESS', shipmentId: r.shipmentId, consignment: r.consignment, parcels: r.parcels,
      request: r.body, label, labelError, format,
    });
  } catch (err) {
    logger.error('[dpd-test-label] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = router;
