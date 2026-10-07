/*
=======================================================================================================================================
API Route: amz_shipment_line
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — put one unit into a box, or take one out. Saved the moment it happens (owner, 2026-10-06: "the boxes aren't
         saving?" → save every change), so a reload, a crash or a second PC shows exactly what is packed.

         One amzshipment row per box + Amazon SKU (the table's key is (box, sku) — not code), qty on the row, the box's measurements
         repeated on every row of it. A +1 upserts that row; a −1 decrements it and deletes it at 0.

         sku / fnsku / supplier are resolved HERE from the code, not taken from the client: sku/fnsku from amzfeed on code (the same
         lookup as amz-shipment-scan, which already refused the scan if there was no FNSKU), supplier = skusummary.supplier (what the
         legacy app writes — checked against amzshipment_archive). A code with no Amazon SKU can't be stored (sku is NOT NULL) and is
         refused with NO_SKU.

         MEASUREMENTS on a new row: copied from the box's existing rows when it has any (so every row of a box agrees), otherwise the
         `dims` the screen sends — an empty box can have measurements typed in before its first unit, and there is no row to hold them
         until now. Kept as strings, as the table stores them.
=======================================================================================================================================
Request Payload:
{ "box": 3, "code": "1010551-039", "delta": 1, "dims": { "length": "46", "width": "46", "height": "33", "weight": "" } }
  — delta is 1 or -1; dims optional.

Success Response:
{ "return_code": "SUCCESS", "qty": 2 }   // the line's qty after the change (0 = the line is gone)
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"     — −1 on a line that isn't stored (the screen is out of step with the DB — reload)
"NO_SKU"        — the code has no Amazon SKU/FNSKU in amzfeed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { cleanDims, addUnitToBox, removeUnitFromBox } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    const code = String(req.body?.code || '').trim();
    const delta = Number(req.body?.delta);
    if (!Number.isInteger(box) || box < 1 || !code || (delta !== 1 && delta !== -1)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box, code and delta (1 or -1) are required' });
    }
    const dims = cleanDims(req.body?.dims);

    // The row writes are utils/amzShipment.js (shared with Goods In, which boxes the Amazon units it books in).
    const outcome = await withTransaction(async (client) => {
      if (delta < 0) {
        const qty = await removeUnitFromBox(client, box, code);
        return qty === null ? { code: 'NOT_FOUND' } : { code: 'SUCCESS', qty };
      }
      const added = await addUnitToBox(client, box, code, dims);
      return added.noSku ? { code: 'NO_SKU' } : { code: 'SUCCESS', qty: added.qty };
    });

    if (outcome.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: `${code} isn't stored in Box ${box} — reload to see what is` });
    }
    if (outcome.code === 'NO_SKU') {
      return res.json({ return_code: 'NO_SKU', message: `${code} has no Amazon SKU/FNSKU, so it can't be saved in a box` });
    }
    return res.json({ return_code: 'SUCCESS', qty: outcome.qty });
  } catch (err) {
    logger.error('[amz-shipment-line] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the box' });
  }
});

module.exports = router;
