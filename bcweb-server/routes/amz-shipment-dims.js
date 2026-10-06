/*
=======================================================================================================================================
API Route: amz_shipment_dims
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — save a box's measurements (length / width / height cm, weight kg). Sent when a measurement field is left, and by
         the Birk box / Set quick fills (owner, 2026-10-06: save every change).

         The measurements live on every amzshipment row of the box, so this sets all of them. A box with nothing in it has no rows, so
         nothing is stored (`saved: false`) — the screen keeps them and amz-shipment-line writes them with the box's first unit.
         A blank or non-numeric value is stored as NULL (utils/amzShipment.js → cleanDims).
=======================================================================================================================================
Request Payload:
{ "box": 3, "dims": { "length": "46", "width": "46", "height": "33", "weight": "12.5" } }

Success Response:
{ "return_code": "SUCCESS", "saved": true }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { cleanDims } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    if (!Number.isInteger(box) || box < 1 || !req.body?.dims) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box and dims are required' });
    }
    const d = cleanDims(req.body.dims);
    // A single UPDATE is atomic on its own — no transaction needed.
    const result = await query(
      `UPDATE amzshipment SET length = $2, width = $3, height = $4, weight = $5 WHERE box = $1`,
      [box, d.length || null, d.width || null, d.height || null, d.weight || null]
    );
    return res.json({ return_code: 'SUCCESS', saved: result.rowCount > 0 });
  } catch (err) {
    logger.error('[amz-shipment-dims] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the measurements' });
  }
});

module.exports = router;
