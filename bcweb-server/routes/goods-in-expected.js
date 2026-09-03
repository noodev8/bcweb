/*
=======================================================================================================================================
API Route: goods_in_expected
=======================================================================================================================================
Method: GET
Purpose: What is on order with a supplier and has NOT yet been booked in — the delivery note the Goods In screen works a box against.
         READ ONLY.

SCOPE is the ON ORDER stage only, across every supplier: ordertype 2/3, arrived = 0, and genuinely placed. "Placed" is
`COALESCE(orderdate,'') <> ''` via utils/orderStatus.js, never `IS NULL` — orderdate is `character varying` and an un-placed row holds
an EMPTY STRING (CLAUDE.md landmine). Getting that wrong returns the whole TO PLACE queue as well, which is goods nobody has bought
yet: they cannot arrive, so listing them as expected would be a lie the operator has to work around.

NO SUPPLIER FILTER, unlike the rest of the Order Status module. That module is worked one supplier at a time because you are chasing
one supplier. Goods In is the other end: a box is open on the bench and what is in it is whatever turned up today. Filtering by
supplier would mean knowing whose box it is before you can scan it, which is backwards — the scan is what tells you.

ONE ROW PER (code, ordertype), NOT PER UNIT. `orderstatus` holds one row per physical unit with qty always 1 (CLAUDE.md), so four
pairs of Arizona 38 are four identical rows; the operator wants to see "Arizona 38 x4" and count them off. ordertype stays in the key
because it decides where the shoe goes — an Amazon (3) unit is staged on C3-Amazon, a local (2) unit goes to the chosen shelf — so
folding the two together would hide the only fact the screen exists to tell you.

BARCODE is `skumap.ean` with the trailing 'B' stripped (CLAUDE.md), the same expression order-status-find.js uses. The client matches
a scan against it, so the strip is not cosmetic: the gun sends the digits without the suffix.

`days` is days since the order was PLACED, from the legacy 'YYYYMMDD HH24:MI:SS' text stamp via placedDate() — the number you would
quote chasing the supplier, not days since the row was chosen. NULL when the stamp could not be parsed.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "total_units": 137,
  "rows": [
    { "code": "1005292-ARIZONA-38", "groupid": "1005292-ARIZONA", "title": "Arizona Stone Coin", "size": "38",
      "barcode": "4051619305203", "supplier": "Birkenstock", "ordertype": 3, "units": 4, "days": 12 }
  ]  // supplier, then title, then size — a delivery note reads in that order
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { placed, placedDate } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // skumap is LEFT JOINed so a line whose SKU has fallen out of the catalogue still shows as expected — it is physically coming
    // whether or not the catalogue agrees, and hiding it would leave the operator with a box they cannot reconcile. Such a row
    // simply has no barcode, and the screen says so rather than dropping it.
    const result = await query(`
      SELECT o.shopifysku AS code,
             o.ordertype,
             MIN(o.supplier) AS supplier,
             MIN(sm.groupid) AS groupid,
             MIN(t.shopifytitle) AS title,
             RIGHT(o.shopifysku, 2) AS size,
             MIN(regexp_replace(COALESCE(sm.ean, ''), 'B$', '')) AS barcode,
             COUNT(*) AS units,
             MAX(CURRENT_DATE - ${placedDate()}) AS days
      FROM orderstatus o
      LEFT JOIN skumap sm ON sm.code = o.shopifysku
      LEFT JOIN title t   ON t.groupid = sm.groupid
      WHERE o.ordertype IN (2,3)
        AND COALESCE(o.arrived, 0) = 0
        AND ${placed()}
      GROUP BY o.shopifysku, o.ordertype
      ORDER BY MIN(o.supplier) ASC, MIN(t.shopifytitle) ASC NULLS LAST, size ASC
    `);

    const rows = result.rows.map((r) => ({
      code: r.code,
      groupid: r.groupid || null,
      title: r.title || null,
      size: r.size,
      barcode: r.barcode || '',
      supplier: r.supplier || null,
      ordertype: Number(r.ordertype),
      units: Number(r.units) || 0,
      days: r.days === null ? null : Number(r.days),
    }));

    const total_units = rows.reduce((n, r) => n + r.units, 0);

    return res.json({ return_code: 'SUCCESS', total_units, rows });
  } catch (err) {
    logger.error('[goods-in-expected] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load what is expected' });
  }
});

module.exports = router;
