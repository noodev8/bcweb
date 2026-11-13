/*
=======================================================================================================================================
API Route: amz_inbound_start
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment's "Do shipment" (part 1 2026-11-12, part 2 2026-11-13): clear Amazon's unconfirmed drafts, make the inbound plan
         from the stored packed boxes, one pack group, prep per SKU, send the boxes, work out the ONE warehouse (never split) — then
         WAIT at the one confirm box (job.state 'confirm'; POST /amz-inbound-confirm books it, /amz-inbound-cancel drops it). Nothing that
         costs money is confirmed here (rules + safety in utils/amzInbound.js, the record in docs/amz-inbound/PLAN.md).
         If these boxes are ALREADY booked on Amazon, the run ends at once in state 'done' (result.already) with Reprint labels.

         Runs IN THE BACKGROUND (~1–3 minutes): this answers at once and the screen follows GET /amz-inbound-status. One at a time.
         The boxes are read and checked HERE first, so an unmeasured box or a screen that's out of date answers straight away.

Request Body: { "boxes": 14, "units": 212 }   // what the screen showed; refused (STALE) if the stored boxes differ
Success Response: { "return_code": "SUCCESS", "job": { ...see amz-inbound-status } }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "BUSY" (a run is going; `job` = it) · "STOPPED" (a box can't go yet — message says why) · "STALE" · "NOT_CONFIGURED" ·
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
    const expect = { boxes: req.body && req.body.boxes, units: req.body && req.body.units };
    let r;
    try {
      r = await inbound.start({ by: req.user.display_name, expect });
    } catch (e) {
      if (/not set|not configured/i.test(e.message)) return res.json({ return_code: 'NOT_CONFIGURED', message: e.message });
      throw e;
    }
    if (r.busy) return res.json({ return_code: 'BUSY', message: 'Do shipment is already running', job: r.busy });
    if (r.stop) return res.json({ return_code: 'STOPPED', message: r.stop });
    if (r.stale) return res.json({ return_code: 'STALE', message: r.stale });
    return res.json({ return_code: 'SUCCESS', job: r.job });
  } catch (err) {
    logger.error('[amz-inbound-start] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to start Do shipment' });
  }
});

module.exports = router;
