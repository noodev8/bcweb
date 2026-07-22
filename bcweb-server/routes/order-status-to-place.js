/*
=======================================================================================================================================
API Route: order_status_to_place
=======================================================================================================================================
Method: GET
Purpose: The order-build sheet for one supplier — every unit CHOSEN but not yet bought (orderdate = '', arrived = 0), aggregated to one
         row per SKU so the operator can check it over, adjust quantities, export the CSV and place the order.

Deliberately NOT the same shape as GET /order-status-list. That endpoint groups by batch (one card per order event) because its job is
"what am I chasing". This one groups by SKU ACROSS every createddate, because its job is "what am I buying from this supplier today" —
if the same size was chosen on Monday and again on Wednesday, the supplier gets one line for 2 pairs, not two orders. `orderstatus`
holds one row PER UNIT (qty always 1, duplicated lines — CLAUDE.md landmine), so qty is COUNT(*) and every underlying `ordernum` is
returned in `ordernums` for the write to stamp and the existing +/- (POST /order-status-adjust-qty) to work on.

Amazon (ordertype 3) and Local (2) units MERGE into one row. The supplier ships us goods; whether a pair is destined for FBA or the
local shelf is our internal routing, not theirs, and the legacy data already places them together (one stamp '20260703 11:33:55' covers
10 local + 2 Amazon rows). `amz_qty`/`local_qty` keep the split visible on screen without fragmenting the order.

`barcode` is `skumap.ean` with the legacy trailing 'B' stripped — that suffix is an Excel guard for the internal spreadsheets, not part
of the real EAN, so it must never reach a supplier's system. `has_barcode` flags the ~61 live SKUs with no EAN at all: the UI blocks
those from the CSV rather than exporting a blank barcode line the supplier would silently mis-read.

Cost is `skusummary.cost` via safeNumeric (style-level, correct for footwear), never `skumap.cost` — see order-status-suppliers.js for
why that column can't be trusted. A row whose cost won't parse returns unit_cost: null and is excluded from the total rather than
counted as zero.
=======================================================================================================================================
Request Query Params:
  supplier  (string, required)

Success Response:
{
  "return_code": "SUCCESS",
  "supplier": "Lunar",
  "rows": [
    { "code": "FLE030-IVES-BLACK-06", "groupid": "FLE030-IVES-BLACK", "title": "Womens Lunar St Ives ...",
      "size": "06", "uksize": "6 UK", "barcode": "5052149511171", "has_barcode": true,
      "qty": 2, "amz_qty": 2, "local_qty": 0, "unit_cost": 15.99, "line_cost": 31.98,
      "oldest_days": 0, "ordernums": ["AMZ-O-WS1-2064", "AMZ-O-WS1-2065"] }
  ],
  "totals": { "units": 3, "skus": 2, "styles": 1, "cost": 47.97, "nocost_units": 0, "nobarcode_units": 0 }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { notPlaced } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { supplier } = req.query;
    if (!supplier) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'supplier is required' });
    }

    // Grouping by the skumap/skusummary columns as well as the SKU is safe (they're functionally dependent on shopifysku) and lets
    // cost/barcode/title be selected without wrapping each in an aggregate. Size = RIGHT(code,2) per CLAUDE.md.
    // regexp_replace(...,'B$','') strips ONLY a trailing B, so a legitimate EAN ending in a digit is untouched.
    const result = await query(`
      SELECT o.shopifysku AS code,
             sm.groupid,
             t.shopifytitle AS title,
             RIGHT(o.shopifysku, 2) AS size,
             sm.uksize,
             regexp_replace(COALESCE(sm.ean, ''), 'B$', '') AS barcode,
             COUNT(*) AS qty,
             COUNT(*) FILTER (WHERE o.ordertype = 3) AS amz_qty,
             COUNT(*) FILTER (WHERE o.ordertype = 2) AS local_qty,
             MAX(CURRENT_DATE - o.createddate) AS oldest_days,
             ${safeNumeric('ss.cost')} AS unit_cost,
             array_agg(o.ordernum ORDER BY o.ordernum) AS ordernums
      FROM orderstatus o
      LEFT JOIN skumap sm     ON sm.code = o.shopifysku
      LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      LEFT JOIN title t       ON t.groupid = sm.groupid
      WHERE o.supplier = $1
        AND o.ordertype IN (2,3)
        AND COALESCE(o.arrived,0) = 0
        AND ${notPlaced()}
      GROUP BY o.shopifysku, sm.groupid, t.shopifytitle, sm.uksize, sm.ean, ss.cost
      ORDER BY t.shopifytitle NULLS LAST, sm.groupid, size
    `, [supplier]);

    const rows = result.rows.map((r) => {
      const qty = Number(r.qty) || 0;
      const unitCost = r.unit_cost === null ? null : Number(r.unit_cost);
      return {
        code: r.code,
        groupid: r.groupid || null,
        title: r.title || null,
        size: r.size,
        uksize: r.uksize || null,
        barcode: r.barcode || '',
        has_barcode: !!r.barcode,
        qty,
        amz_qty: Number(r.amz_qty) || 0,
        local_qty: Number(r.local_qty) || 0,
        unit_cost: unitCost,
        line_cost: unitCost === null ? null : Number((unitCost * qty).toFixed(2)),
        oldest_days: r.oldest_days === null ? 0 : Number(r.oldest_days),
        ordernums: r.ordernums || [],
      };
    });

    // Totals computed here rather than client-side so the headline figure can't drift from the rows it summarises.
    const totals = {
      units: rows.reduce((n, r) => n + r.qty, 0),
      skus: rows.length,
      styles: new Set(rows.map((r) => r.groupid).filter(Boolean)).size,
      cost: Number(rows.reduce((n, r) => n + (r.line_cost || 0), 0).toFixed(2)),
      nocost_units: rows.filter((r) => r.unit_cost === null).reduce((n, r) => n + r.qty, 0),
      nobarcode_units: rows.filter((r) => !r.has_barcode).reduce((n, r) => n + r.qty, 0),
    };

    return res.json({ return_code: 'SUCCESS', supplier, rows, totals });
  } catch (err) {
    logger.error('[order-status-to-place] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the order' });
  }
});

module.exports = router;
