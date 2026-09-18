/*
=======================================================================================================================================
API Route: finance_car
=======================================================================================================================================
Method: GET
Purpose: Finance / Month End — hand the screen the car mileage total for one month, read live from the owner's Google Sheet, so the
         Car box arrives filled in instead of being re-keyed from a spreadsheet the owner has to go and open. READ ONLY: it reads a
         sheet and touches neither the database nor the sheet itself.

IT IS A SUGGESTION, NOT AN AUTHORITY. The Car box stays typed and editable, and what the screen sends to /finance-calculate is still
whatever is in that box. This route only saves the hunting and the adding up. If the sheet is unreachable, unshared or not configured,
the month must still close by hand — which is why nothing here is an error the screen has to stop on (see the return codes).

WHY THE JOURNEYS COME BACK TOO. A bare total is a number you have to believe. The month's rows travel with it so the screen can show
what it is made of, which is this module's rule everywhere else (spec: every figure arrives with its evidence) and the only way a
missing journey is visible before the books are closed rather than at year end.

WHY IT IS NOT PART OF /finance-calculate. That route is a POST that uploads files and takes half a minute on the Shopify pull; this is
a cheap read the screen wants BEFORE any of that, the moment the month is known, so the figure is on screen while the files are being
dropped. Folding it in would tie a one-second read to a thirty-second one and delay the pre-fill until after Calculate, which is the
point at which it has stopped being a pre-fill.

Sheet access: shared with the service account as Viewer (utils/googleSheets.js says which address). Sheet id in GOOGLE_CAR_SHEET_ID.
=======================================================================================================================================
Request: GET /finance-car?month=YYYY-MM
  month   REQUIRED, 'YYYY-MM' — the month being closed. Explicit for the same reason /finance-calculate demands it: deriving the month
          from today's date IS the PowerBuilder January bug (spec section 9.1).

Success Response:
{
  "return_code": "SUCCESS",
  "month": "2026-08",
  "configured": true,
  "total": 119.70,
  "journeys": 2,
  "miles": 266,
  "skipped": 0,
  "rows": [ { "date": "14/08/2026", "miles": 100, "description": "5MS Marketing meeting Wolverhampton", "amount": 45.00 },
            { "date": "16/08/2026", "miles": 166, "description": "Footwear live show",                 "amount": 74.70 } ]
}
A month with no journeys is SUCCESS with total 0 and an empty `rows` — that is a real answer, not a failure.
=======================================================================================================================================
Return Codes:
"SUCCESS"           the sheet was read (`configured:false` means no sheet is set up — still a success, just nothing to offer)
"MISSING_MONTH"     no month, or not YYYY-MM
"SHEET_UNAVAILABLE" the sheet could not be read — `message` says why (not shared with the service account, tab renamed, Google down).
                    The screen shows this as a quiet note beside a Car box that still works by hand; it must never block a month.
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { carExpense } = require('../utils/financeCar');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const month = String(req.query.month || '');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.json({ return_code: 'MISSING_MONTH', message: "month is required as 'YYYY-MM'" });
    }

    let result;
    try {
      result = await carExpense(month);
    } catch (err) {
      // A sheet problem is reported, not thrown at the operator: they can still type the figure, and the message names the fix.
      logger.error('[finance-car] sheet read failed:', err.message);
      return res.json({ return_code: 'SHEET_UNAVAILABLE', message: err.message });
    }

    logger.info(`[finance-car] ${req.user.display_name}: ${month} — ${result.journeys} journeys, ${result.total}`);

    return res.json({ return_code: 'SUCCESS', month, ...result });
  } catch (err) {
    logger.error('[finance-car] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to read the car expenses' });
  }
});

module.exports = router;
