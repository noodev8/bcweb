/*
=======================================================================================================================================
API Route: amz_inbound_confirm
=======================================================================================================================================
Method: POST
Purpose: The ONE confirm box of "Do shipment" (part 2, 2026-11-13 — docs/amz-inbound/PLAN.md). The run is waiting (job.state 'confirm')
         with the plan made, the boxes sent and the ONE warehouse worked out. This books it with the ready-to-ship date the owner picked:
         our own DPD and the delivery window are worked out FIRST (a missing one stops and cancels, free), then the warehouse is
         confirmed (Amazon's placement fees are charged from here), the delivery window, our DPD; then the FBA15 id is read back and the
         screen prints the box labels (GET /amz-inbound-labels). From here the boxes are frozen until Mark shipped.

         Runs IN THE BACKGROUND (under a minute): answers at once, the screen follows GET /amz-inbound-status.
         The boxes are re-read: if they changed since the press, nothing is booked and the plan is cancelled.

Request Body: { "id": 3, "readyDate": "2026-11-14", "boxes": 14, "units": 212 }   // the job shown; the date picked (today or later)
Success Response: { "return_code": "SUCCESS", "job": { ...see amz-inbound-status } }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOT_WAITING" (no run waiting at the confirm box — e.g. another bench pressed Do shipment again) · "BAD_DATE" ·
"UNAUTHORIZED" · "SERVER_ERROR"
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
    const r = await inbound.confirm({ id: b.id, readyDate: b.readyDate, expect: { boxes: b.boxes, units: b.units } });
    if (r.error === 'NOT_WAITING') {
      return res.json({ return_code: 'NOT_WAITING', message: 'This shipment isn’t waiting to be confirmed any more. Press Do shipment again.' });
    }
    if (r.error === 'BAD_DATE') return res.json({ return_code: 'BAD_DATE', message: 'Pick a ready-to-ship date, today or later' });
    logger.info(`[amz-inbound-confirm] job ${b.id} ready ${b.readyDate} — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', job: r.job });
  } catch (err) {
    logger.error('[amz-inbound-confirm] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to confirm the shipment' });
  }
});

module.exports = router;
