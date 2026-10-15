/*
=======================================================================================================================================
API Route: amz_shipment_box_lock
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — lock or unlock a box (owner, 2026-10-15: "if a box is done they lock whats in it and its values").

         A locked box's contents and measurements can't change until it's unlocked: amz-shipment-line, amz-shipment-dims,
         amz-shipment-box-empty and amz-shipment-box-delete all refuse it (LOCKED), and Goods In starts a new box instead of adding to it.
         Stored as `amzshipment.locked` on every row of the box (migrations/20261015_amzshipment_locked.sql). Only a box with something
         in it can be locked — an empty box has no rows to hold the flag.

         Explicit value, not a toggle, so two benches can't flip it to the opposite of what either meant.
=======================================================================================================================================
Request Payload:
{ "box": 3, "locked": true }

Success Response:
{ "return_code": "SUCCESS", "box": 3, "locked": true }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" (nothing stored in that box) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    const locked = req.body?.locked;
    if (!Number.isInteger(box) || box < 1 || typeof locked !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box and locked (true or false) are required' });
    }
    // A single UPDATE is atomic on its own — no transaction needed.
    const result = await query(`UPDATE amzshipment SET locked = $2 WHERE box = $1`, [box, locked]);
    if (result.rowCount === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `Box ${box} has nothing in it to lock` });
    }
    logger.info(`[amz-shipment-box-lock] box ${box} ${locked ? 'locked' : 'unlocked'} — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', box, locked });
  } catch (err) {
    logger.error('[amz-shipment-box-lock] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to lock the box' });
  }
});

module.exports = router;
