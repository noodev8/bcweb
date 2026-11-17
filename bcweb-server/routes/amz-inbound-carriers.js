/*
=======================================================================================================================================
API Route: amz_inbound_carriers
=======================================================================================================================================
Method: POST
Purpose: The ONE confirm box of "Do shipment" (docs/amz-inbound/PLAN.md), once a ready-to-ship date is picked: asks Amazon for the
         carriers for that date and answers with the two DPDs: is OUR OWN DPD offered (Amazon charges nothing), and AMAZON'S DPD with
         Amazon's price. The owner then chooses one (owner 2026-11-17). Nothing is confirmed or charged (generateTransportationOptions
         + list only), so it's a POST only because Amazon's "generate" is one. Takes a few seconds (Amazon works it out).

Request Body: { "id": 3, "readyDate": "2026-11-19" }   // the job waiting at the confirm box; the date picked (today or later)
Success Response:
{
  "return_code": "SUCCESS",
  "carriers": {
    "readyDate": "2026-11-19",
    "own": true,                                             // our own DPD offered
    "amazon": { "cost": 2.86, "currency": "GBP",             // Amazon's DPD and its price; null when Amazon doesn't offer it
                "voidableUntil": "2026-11-20T…Z" | null, "expires": "…" | null }
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NOT_WAITING" (no run waiting at the confirm box) · "BAD_DATE" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const r = await inbound.carriers({ id: b.id, readyDate: b.readyDate });
    if (r.error === 'NOT_WAITING') {
      return res.json({ return_code: 'NOT_WAITING', message: 'This shipment isn’t waiting to be confirmed any more. Press Do shipment again.' });
    }
    if (r.error === 'BAD_DATE') return res.json({ return_code: 'BAD_DATE', message: 'Pick a ready-to-ship date, today or later' });
    return res.json({ return_code: 'SUCCESS', carriers: r.carriers });
  } catch (err) {
    logger.error('[amz-inbound-carriers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: `Couldn’t get the carriers from Amazon (${err.message})` });
  }
});

module.exports = router;
