/*
=======================================================================================================================================
API Route: amz_shipment_pack
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Pack": the user's active box is done, so store it and give it its number (owner, 2026-10-16: "dont want the
         box saved until its locked ... dont even give them a box num till they press pack. then tell them their box num").

         Until now the box lived only in the user's browser (bcweb-web/src/lib/amzActiveBox.ts). This writes it to amzshipment in one
         transaction: one row per box + Amazon SKU (the table's key), qty on the row, the measurements on every row, `locked = true`
         (on screen: packed). The number is max(box) + 1, taken under a transaction-scoped advisory lock so two benches packing at once
         can't both get the same one. It comes back in the response and the screen says it.

         sku / fnsku / supplier are resolved HERE from the code (utils/amzShipment.js → lookupAmzProduct), not taken from the client. A
         code with no Amazon SKU/FNSKU can't be stored (sku is NOT NULL): the whole pack is refused (NO_SKU, naming the code) and nothing
         is written — the box stays in the browser to be fixed. Only a MEASURED AND WEIGHED box can be packed (as for lock, owner
         2026-10-15): all four measurements, positive numbers.

         Stock is untouched — boxing never moved localstock (see amz-shipment-ship).
=======================================================================================================================================
Request Payload:
{ "lines": [ { "code": "1010551-039", "qty": 2 } ], "dims": { "length": "46", "width": "46", "height": "33", "weight": "12.5" } }

Success Response:
{ "return_code": "SUCCESS", "box": 14, "units": 2 }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_MEASURED" (any of the four measurements missing) · "NO_SKU" (a code with no Amazon SKU/FNSKU) ·
"UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { cleanDims, lookupAmzProduct } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.lines) ? req.body.lines : [];
    // The same code twice is one line (the screen already merges them; this makes the route right on its own).
    const qtyByCode = new Map();
    for (const l of raw) {
      const code = String(l?.code || '').trim();
      const qty = Number(l?.qty);
      if (!code || !Number.isInteger(qty) || qty < 1 || qty > 999) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'every line needs a code and a qty of 1 or more' });
      }
      qtyByCode.set(code, (qtyByCode.get(code) || 0) + qty);
    }
    if (qtyByCode.size === 0) return res.json({ return_code: 'MISSING_FIELDS', message: 'The box is empty — nothing to pack' });
    const d = cleanDims(req.body?.dims);
    if (!d.length || !d.width || !d.height || !d.weight) {
      return res.json({ return_code: 'NOT_MEASURED', message: 'Put in the length, width, height and weight before packing' });
    }

    const out = await withTransaction(async (client) => {
      const products = [];
      for (const [code, qty] of qtyByCode) {
        const p = await lookupAmzProduct(client, code);
        if (!p || !p.sku || !p.fnsku) return { noSku: code };
        products.push({ ...p, qty });
      }
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('amzshipment:new-box'))`);
      const box = Number((await client.query(`SELECT COALESCE(MAX(box), 0) + 1 AS box FROM amzshipment`)).rows[0].box);
      for (const p of products) {
        // ON CONFLICT: two codes sharing one Amazon SKU are one row, as the key requires.
        await client.query(
          `INSERT INTO amzshipment (box, supplier, code, sku, fnsku, qty, weight, length, height, width, locked)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
           ON CONFLICT (box, sku) DO UPDATE SET qty = COALESCE(amzshipment.qty, 0) + EXCLUDED.qty`,
          [box, p.supplier, p.code, p.sku, p.fnsku, p.qty, d.weight, d.length, d.height, d.width]
        );
      }
      return { box, units: products.reduce((n, p) => n + p.qty, 0) };
    });

    if (out.noSku) {
      return res.json({ return_code: 'NO_SKU', message: `${out.noSku} has no Amazon SKU/FNSKU, so the box can't be packed — take it out first` });
    }
    logger.info(`[amz-shipment-pack] box ${out.box}: ${out.units} units — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', box: out.box, units: out.units });
  } catch (err) {
    logger.error('[amz-shipment-pack] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to pack the box' });
  }
});

module.exports = router;
