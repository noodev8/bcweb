/*
=======================================================================================================================================
API Route: finance-car-sheet
=======================================================================================================================================
Method: GET
Purpose: Finance / Month End — the address of the owner's car mileage Google Sheet, so the screen can always offer an "Open" button.
         Separate from /finance-car on purpose: the link must show before (and without) a read of the sheet, which only happens
         when the operator presses Fetch, and must still show when that read fails - the usual reason to open the sheet is to fix it
         or add a missing journey. Builds a URL from config; touches neither the database nor Google.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/<id>/edit"   // null when GOOGLE_CAR_SHEET_ID is not set
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const config = require('../config/config');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', (req, res) => {
  try {
    const id = config.sheets.carSheetId;
    return res.json({ return_code: 'SUCCESS', sheetUrl: id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : null });
  } catch (err) {
    logger.error('[finance-car-sheet] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to read the sheet address' });
  }
});

module.exports = router;
