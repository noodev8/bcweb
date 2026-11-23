/*
=======================================================================================================================================
API Route: amz_inbound_confirm
=======================================================================================================================================
Method: POST
Purpose: The ONE confirm box of "Do shipment" (part 2, 2026-11-13 — docs/amz-inbound/PLAN.md). The run is waiting (job.state 'confirm')
         with the plan made, the boxes sent and the ONE warehouse worked out. This books it with the ready-to-ship date and the DPD the
         owner picked (POST /amz-inbound-carriers showed them; owner 2026-11-17): the chosen DPD (and, for our own DPD, the delivery
         window) are worked out FIRST (a missing one stops and cancels, free; Amazon's DPD dearer than the price shown goes back to the
         confirm box with the new price, nothing confirmed), then the warehouse is confirmed (Amazon's placement fees are charged from
         here), the delivery window (own DPD only), the DPD (Amazon's DPD is charged from here); then the FBA15 id is read back and the
         screen prints the box labels (GET /amz-inbound-labels). From here the boxes are frozen until Mark shipped.

         Runs IN THE BACKGROUND (under a minute): answers at once, the screen follows GET /amz-inbound-status.
         The boxes are re-read: if they changed since the press, nothing is booked and the plan is cancelled.

Request Body: { "id": 3, "readyDate": "2026-11-14", "carrier": "own" | "amazon" | "ups", "maxCost": 2.86, "boxes": 14, "units": 212 }
              // the job shown; the date picked (today or later); the carrier chosen (own DPD, Amazon's DPD, Amazon's UPS — owner
              // 2026-11-23); for Amazon's DPD / UPS the price shown (never paid above it)
Success Response: { "return_code": "SUCCESS", "job": { ...see amz-inbound-status } }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOT_WAITING" (no run waiting at the confirm box — e.g. another bench pressed Do shipment again) · "BAD_DATE" ·
"BAD_CARRIER" (no carrier chosen, or Amazon's DPD / UPS without the price shown) · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const b = req.body || {};
    const r = await inbound.confirm({ id: b.id, readyDate: b.readyDate, carrier: b.carrier, maxCost: b.maxCost, expect: { boxes: b.boxes, units: b.units } });
    if (r.error === 'NOT_WAITING') {
      return res.json({ return_code: 'NOT_WAITING', message: 'This shipment isn’t waiting to be confirmed any more. Press Do shipment again.' });
    }
    if (r.error === 'BAD_DATE') return res.json({ return_code: 'BAD_DATE', message: 'Pick a ready-to-ship date, today or later' });
    if (r.error === 'BAD_CARRIER') return res.json({ return_code: 'BAD_CARRIER', message: 'Pick our own DPD, Amazon’s DPD or Amazon’s UPS' });
    const what = { amazon: `Amazon's DPD ≤ £${b.maxCost}`, ups: `Amazon's UPS ≤ £${b.maxCost}` }[b.carrier] || 'own DPD';
    logger.info(`[amz-inbound-confirm] job ${b.id} ready ${b.readyDate}, ${what} — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', job: r.job });
  } catch (err) {
    logger.error('[amz-inbound-confirm] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to confirm the shipment' });
  }
});

module.exports = router;
