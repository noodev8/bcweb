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
const { cleanDims } = require('../utils/amzShipment');
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

    const outcome = await withTransaction(async (client) => {
      if (delta < 0) {
        const row = (await client.query(
          `UPDATE amzshipment SET qty = COALESCE(qty, 0) - 1 WHERE box = $1 AND code = $2 RETURNING sku, qty`,
          [box, code]
        )).rows[0];
        if (!row) return { code: 'NOT_FOUND' };
        if (row.qty <= 0) await client.query(`DELETE FROM amzshipment WHERE box = $1 AND sku = $2`, [box, row.sku]);
        return { code: 'SUCCESS', qty: Math.max(0, row.qty) };
      }

      const product = (await client.query(
        `SELECT COALESCE(af.sku, '') AS sku, COALESCE(af.fnsku, '') AS fnsku, ss.supplier
           FROM skumap m
           LEFT JOIN skusummary ss ON ss.groupid = m.groupid
           LEFT JOIN LATERAL (SELECT a.sku, a.fnsku FROM amzfeed a WHERE a.code = m.code AND COALESCE(a.fnsku, '') <> '' LIMIT 1) af ON true
          WHERE m.code = $1
          ORDER BY COALESCE(m.deleted, 0) ASC
          LIMIT 1`,
        [code]
      )).rows[0];
      if (!product || !product.sku || !product.fnsku) return { code: 'NO_SKU' };

      // The box's stored measurements win over the client's, so a box's rows never disagree.
      const stored = (await client.query(
        `SELECT MAX(length) AS length, MAX(width) AS width, MAX(height) AS height, MAX(weight) AS weight FROM amzshipment WHERE box = $1`,
        [box]
      )).rows[0];
      const d = stored.length || stored.width || stored.height || stored.weight ? stored : dims;

      const row = (await client.query(
        `INSERT INTO amzshipment (box, supplier, code, sku, fnsku, qty, weight, length, height, width)
         VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)
         ON CONFLICT (box, sku) DO UPDATE SET qty = COALESCE(amzshipment.qty, 0) + 1
         RETURNING qty`,
        [box, product.supplier, code, product.sku, product.fnsku, d.weight || null, d.length || null, d.height || null, d.width || null]
      )).rows[0];
      return { code: 'SUCCESS', qty: row.qty };
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
