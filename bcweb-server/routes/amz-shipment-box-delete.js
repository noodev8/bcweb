/*
=======================================================================================================================================
API Route: amz_shipment_box_delete
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Delete box": remove a box and everything in it from amzshipment (owner, 2026-10-06: save every change).
         The screen confirms first when the box isn't empty.

         RENUMBER (owner, 2026-10-06: "if a box is deleted we renumber boxes"). The boxes after it move down one — delete Box 3 of 5 and
         Box 4 becomes 3, Box 5 becomes 4 — so our numbers always run 1..n and match Amazon's P1 - B1..Bn in the Amazon upload file.
         The table's key is (box, sku) and checked row by row, so a plain `box = box - 1` can collide mid-update (Box 5's row moving
         onto Box 4's same SKU before Box 4's has moved); the shift goes through negatives instead, in the same transaction.

         Stock is untouched — boxing never moved localstock (see amz-shipment-ship), so the units are simply back to unboxed.
=======================================================================================================================================
Request Payload:
{ "box": 3 }

Success Response:
{ "return_code": "SUCCESS", "removed": 4, "renumbered": 6 }   // rows deleted (0 for a box never stored) / rows moved down a box
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
    const { removed, renumbered } = await withTransaction(async (client) => {
      const del = await client.query(`DELETE FROM amzshipment WHERE box = $1`, [box]);
      await client.query(`UPDATE amzshipment SET box = -box WHERE box > $1`, [box]);
      const moved = await client.query(`UPDATE amzshipment SET box = -box - 1 WHERE box < 0`);
      return { removed: del.rowCount, renumbered: moved.rowCount };
    });
    logger.info(`[amz-shipment-box-delete] box ${box}: ${removed} rows, ${renumbered} moved down — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', removed, renumbered });
  } catch (err) {
    logger.error('[amz-shipment-box-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete the box' });
  }
});

module.exports = router;
