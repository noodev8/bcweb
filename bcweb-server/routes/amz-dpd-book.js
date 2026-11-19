/*
=======================================================================================================================================
API Route: amz_dpd_book
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment's "Book DPD" (owner, 2026-11-19 — docs/dpd/NOTES.md; rules in utils/amzInbound.js → BOOK DPD). For the booked
         Amazon shipment, OUR OWN DPD only: books one DPD Parcel Next Day consignment from our address to Amazon's warehouse (parcels =
         Amazon's boxes, weight = their kg), then sends the tracking to Amazon straight away (box U00000n → DPD parcel n). The screen then
         prints the DPD labels on the DPD printer (GET /amz-dpd-label).

         DPD_LIVE: until it is "true" in .env (after DPD's label sign-off) the booking stops at DPD's ?test=true check — DPD validates the
         details, NOTHING is booked, no tracking is sent, and the answer says so (test: true).

         Never books twice: a shipment Amazon already has tracking for → ALREADY; a booking whose tracking didn't reach Amazon is re-sent on
         the next press, not booked again.

Request Body: {}
Success Response:
  { "return_code": "SUCCESS", "test": true, "boxes": 6, "kg": 52.4 }                                     // test mode: nothing booked
  { "return_code": "SUCCESS", "dpd": { "consignment": "6813151615", "parcels": ["15976…"], "trackingSent": true, "canReprint": true },
    "trackingError": "…" }                                                                                // trackingError only if Amazon refused it
=======================================================================================================================================
Return Codes:
"SUCCESS" · "BUSY" (another press is booking) · "NOT_BOOKED" (no booked Amazon shipment for the stored boxes) · "NOT_OWN_DPD" (booked
with Amazon's DPD — Amazon makes those labels) · "ALREADY" (Amazon has tracking for it already) · "PARCEL_COUNT" (DPD's parcel numbers
don't match the boxes: booked, but no tracking sent) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const inbound = require('../utils/amzInbound');
const logger = require('../utils/logger');

router.use(verifyToken);

const MESSAGES = {
  BUSY: 'DPD is being booked from another screen. Wait a moment.',
  NOT_BOOKED: 'There’s no booked Amazon shipment for these boxes.',
  NOT_OWN_DPD: 'This shipment is booked with Amazon’s DPD, so Amazon makes its labels. Book DPD is for our own DPD only.',
  ALREADY: 'Amazon already has the tracking for this shipment, so DPD is not booked again.',
};

router.post('/', async (req, res) => {
  try {
    const r = await inbound.bookDpd({ by: req.user.display_name });
    if (r.error === 'PARCEL_COUNT') return res.json({ return_code: 'PARCEL_COUNT', message: r.message, dpd: r.dpd });
    if (r.error) return res.json({ return_code: r.error, message: MESSAGES[r.error] || r.error });
    logger.info(`[amz-dpd-book] ${r.test ? 'test mode, nothing booked' : `consignment ${r.dpd && r.dpd.consignment}`} — by ${req.user.display_name}`);
    if (r.test) return res.json({ return_code: 'SUCCESS', test: true, boxes: r.boxes, kg: r.kg });
    return res.json({ return_code: 'SUCCESS', dpd: r.dpd, trackingError: r.trackingError || null });
  } catch (err) {
    logger.error('[amz-dpd-book] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: `Couldn’t book DPD: ${err.message}` });
  }
});

module.exports = router;
