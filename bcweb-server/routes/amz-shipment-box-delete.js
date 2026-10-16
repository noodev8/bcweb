/*
=======================================================================================================================================
API Route: amz_shipment_box_delete
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Delete box": a stored box and everything in it come out of amzshipment for good (owner, 2026-10-16: delete
         kept separate from Empty, which keeps the number — "the only thing that changes numbers is deleting a box"). The screen
         confirms first.

         RENUMBER (owner, 2026-10-06: "if a box is deleted we renumber boxes"). The boxes after it move down one — delete Box 3 of 5 and
         Box 4 becomes 3, Box 5 becomes 4 — so our numbers always run 1..n and match Amazon's B1..Bn in the Amazon upload file
         (utils/amzShipment.js → deleteBoxAndRenumber).

         STALE GUARD. The screen sends what it showed in the box (`expect`, [{ code, qty }]); if the stored box differs — the numbers
         moved under another bench's delete — nothing is deleted (STALE) and the screen re-reads (lockBoxIfUnchanged).

         Stock is untouched — boxing never moved localstock (see amz-shipment-ship), so the units are simply back to unboxed.
=======================================================================================================================================
Request Payload:
{ "box": 3, "expect": [ { "code": "1010551-039", "qty": 2 } ] }

Success Response:
{ "return_code": "SUCCESS", "box": 3, "removed": 4 }   // rows deleted
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "STALE" (no such box, or it isn't what the screen showed) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { deleteBoxAndRenumber, lockBoxIfUnchanged } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    const expect = req.body?.expect;
    if (!Number.isInteger(box) || box < 1 || !Array.isArray(expect)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box and expect are required' });
    }
    const removed = await withTransaction(async (client) => {
      // Serialised with Pack (same advisory lock), so numbers can't move under either mid-way.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('amzshipment:new-box'))`);
      if (!(await lockBoxIfUnchanged(client, box, expect))) return null;
      return deleteBoxAndRenumber(client, box);
    });
    if (removed === null) {
      return res.json({ return_code: 'STALE', message: `Box ${box} has changed since this screen loaded — it's been reloaded, check it and try again` });
    }
    logger.info(`[amz-shipment-box-delete] box ${box}: ${removed} rows, later boxes moved down — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', box, removed });
  } catch (err) {
    logger.error('[amz-shipment-box-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete the box' });
  }
});

module.exports = router;
