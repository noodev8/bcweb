/*
=======================================================================================================================================
API Route: amz_shipment_boxes
=======================================================================================================================================
Method: GET
Purpose: AMZ Shipment screen — the Amazon boxes packed so far and what is in each. READ ONLY.

         Source is the legacy `amzshipment` table: one row per box + code, with qty, the Amazon sku/fnsku, the supplier, and the box's
         measurements (weight kg, length/width/height cm) repeated on every row of that box. Those four are character varying, so
         they are passed through as strings — the screen holds measurements as typed strings anyway. On live data every box carries
         exactly one set of measurements, so MAX() per box just picks it; if a box ever had rows that disagreed the largest wins.

         The rows stay here until the shipment goes; the PowerBuilder flow then moves them to amzshipment_archive (inv-stock's
         `transit` bucket reads that). The units are STILL in localstock (C3-Amazon, allocated 'amz') while boxed — see the
         `boxed` note in routes/inv-stock.js — so nothing here is stock in its own right.

         title is joined via skumap -> title purely so the packer can see what a code is (LATERAL ... LIMIT 1 so a code with two
         skumap rows can't double a line).
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "boxes": [
    { "box": 1, "weight": "15", "length": "63", "width": "62", "height": "43",
      "lines": [ { "code": "FLE030-IVES-BEIGE-04", "sku": "FLE030 BG-04", "fnsku": "X001L0082L", "supplier": "Lunar",
                   "title": "Womens Lunar St Ives Leather Casual Trainer Beige", "qty": 4 } ] }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.box, s.code, COALESCE(s.sku, '') AS sku, COALESCE(s.fnsku, '') AS fnsku, COALESCE(s.supplier, '') AS supplier,
              COALESCE(t.shopifytitle, '') AS title, COALESCE(s.qty, 0) AS qty,
              MAX(s.weight) OVER w AS weight, MAX(s.length) OVER w AS length,
              MAX(s.width)  OVER w AS width,  MAX(s.height) OVER w AS height
       FROM amzshipment s
       LEFT JOIN LATERAL (SELECT m.groupid FROM skumap m WHERE m.code = s.code LIMIT 1) m ON true
       LEFT JOIN title t ON t.groupid = m.groupid
       WINDOW w AS (PARTITION BY s.box)
       ORDER BY s.box, s.code`
    );

    // Rows arrive box-ordered, so a box is started on its first row and filled from the rest.
    const boxes = [];
    for (const r of result.rows) {
      let b = boxes[boxes.length - 1];
      if (!b || b.box !== r.box) {
        b = { box: r.box, weight: r.weight || '', length: r.length || '', width: r.width || '', height: r.height || '', lines: [] };
        boxes.push(b);
      }
      b.lines.push({ code: r.code, sku: r.sku, fnsku: r.fnsku, supplier: r.supplier, title: r.title, qty: Number(r.qty) });
    }

    return res.json({ return_code: 'SUCCESS', boxes });
  } catch (err) {
    logger.error('[amz-shipment-boxes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Amazon boxes' });
  }
});

module.exports = router;
