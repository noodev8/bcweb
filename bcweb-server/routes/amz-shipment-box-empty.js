/*
=======================================================================================================================================
API Route: amz_shipment_box_empty
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Empty box": take everything out of a box but keep the box (owner, 2026-10-15). The screen confirms first.

         Unlike Delete box (amz-shipment-box-delete) nothing is RENUMBERED: the box keeps its number and stays on screen, with its
         measurements, ready to be packed again. A box is only stored while it holds something (one amzshipment row per box + SKU, the
         measurements on every row), so emptying it deletes its rows; the screen sends the measurements again with the next unit
         scanned into it, exactly as for a new box.

         Stock is untouched — boxing never moved localstock (see amz-shipment-ship), so the units are simply back to unboxed.
=======================================================================================================================================
Request Payload:
{ "box": 3 }

Success Response:
{ "return_code": "SUCCESS", "removed": 4 }   // rows deleted (0 for a box never stored)
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    if (!Number.isInteger(box) || box < 1) return res.json({ return_code: 'MISSING_FIELDS', message: 'box is required' });
    const removed = await withTransaction(async (client) => {
      const del = await client.query(`DELETE FROM amzshipment WHERE box = $1`, [box]);
      return del.rowCount;
    });
    logger.info(`[amz-shipment-box-empty] box ${box}: ${removed} rows removed — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', removed });
  } catch (err) {
    logger.error('[amz-shipment-box-empty] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to empty the box' });
  }
});

module.exports = router;
