/*
=======================================================================================================================================
API Route: amz_shipment_unpack
=======================================================================================================================================
Method: POST
Purpose: AMZ Shipment — "Unpack": a packed box needs changing, so it comes OUT of amzshipment and goes back to being the user's active
         box (owner, 2026-10-16: unpack moves it back to the active box; the number is freed and later boxes renumber). The screen only
         offers it while the user's active box is empty, and puts what this returns into it.

         One transaction: the box's lines and measurements are read, its rows deleted, and the boxes after it move down one
         (utils/amzShipment.js → deleteBoxAndRenumber — numbers stay 1..n for the Amazon upload). Packing it again gives it a new number.
         Works on a box that isn't packed too (one the legacy app wrote) — that's how one gets into the user's box to be packed here.

         STALE GUARD. The screen sends the units it showed for that box. If the stored box differs — another bench unpacked an earlier
         box and the numbers moved, or the legacy app changed it — nothing is taken and the screen re-reads (STALE).

         Stock is untouched — boxing never moved localstock (see amz-shipment-ship).
=======================================================================================================================================
Request Payload:
{ "box": 7, "units": 12 }

Success Response:
{ "return_code": "SUCCESS", "box": 7,
  "lines": [ { "code": "1010551-039", "sku": "1010551-039", "fnsku": "X000Q6ARLD", "groupid": "1010551", "title": "Arizona …", "qty": 2 } ],
  "dims": { "length": "46", "width": "46", "height": "33", "weight": "12.5" } }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" (no such box) · "STALE" (the box isn't what the screen showed) · "UNAUTHORIZED" ·
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { deleteBoxAndRenumber } = require('../utils/amzShipment');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const box = Number(req.body?.box);
    const units = Number(req.body?.units);
    if (!Number.isInteger(box) || box < 1 || !Number.isInteger(units)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'box and units are required' });
    }

    const out = await withTransaction(async (client) => {
      // Serialised with Pack (same advisory lock), so a pack can't take a number while this one is closing the gap.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('amzshipment:new-box'))`);
      const rows = (await client.query(
        `SELECT s.code, s.sku, COALESCE(s.fnsku, '') AS fnsku, COALESCE(m.groupid, '') AS groupid,
                COALESCE(t.shopifytitle, '') AS title, COALESCE(s.qty, 0) AS qty,
                COALESCE(s.length, '') AS length, COALESCE(s.width, '') AS width,
                COALESCE(s.height, '') AS height, COALESCE(s.weight, '') AS weight
           FROM amzshipment s
           LEFT JOIN LATERAL (SELECT m.groupid FROM skumap m WHERE m.code = s.code LIMIT 1) m ON true
           LEFT JOIN title t ON t.groupid = m.groupid
          WHERE s.box = $1
          ORDER BY s.code
          FOR UPDATE OF s`,
        [box]
      )).rows;
      if (rows.length === 0) return { fail: 'NOT_FOUND' };
      if (rows.reduce((n, r) => n + Number(r.qty), 0) !== units) return { fail: 'STALE' };
      await deleteBoxAndRenumber(client, box);
      // Every row of a box carries the same measurements; the largest wins if they ever disagree (as amz-shipment-boxes reads them).
      const dims = { length: '', width: '', height: '', weight: '' };
      for (const r of rows) for (const k of Object.keys(dims)) if (Number(r[k]) > Number(dims[k] || 0)) dims[k] = r[k];
      return {
        lines: rows.map((r) => ({ code: r.code, sku: r.sku, fnsku: r.fnsku, groupid: r.groupid, title: r.title, qty: Number(r.qty) })),
        dims,
      };
    });

    if (out.fail === 'NOT_FOUND') return res.json({ return_code: 'NOT_FOUND', message: `There is no Box ${box}` });
    if (out.fail === 'STALE') {
      return res.json({ return_code: 'STALE', message: `Box ${box} has changed since this screen loaded — it's been reloaded, check it and try again` });
    }
    logger.info(`[amz-shipment-unpack] box ${box}: ${out.lines.length} lines back to a user's box — by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', box, lines: out.lines, dims: out.dims });
  } catch (err) {
    logger.error('[amz-shipment-unpack] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to unpack the box' });
  }
});

module.exports = router;
