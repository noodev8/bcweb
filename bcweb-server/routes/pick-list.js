/*
=======================================================================================================================================
API Route: pick_list
=======================================================================================================================================
Method: GET
Purpose: The Pick module's list — the physical units someone has to walk to a shelf and take. Ported from the legacy PowerBuilder Pick
         screen (of_refreshdb), which is still live in parallel, as is the mobile app that does the actual picking.

TWO LISTS, ONE TABLE. Both modes are `localstock` under a different WHERE, exactly as the legacy screen had them (verified against the
live DB on 2026-08-30 — each filter returned precisely the rows in the owner's screenshots, 9 and 6):

  shopify   ordernum <> '#FREE' AND deleted = 0        units orderSync phase E RESERVED against a customer order (ordertype 1).
                                                       The walk-to-the-shelf list. `ordernum` is the BC….
  amazon    allocated = 'amz' AND location <> 'C3-Amazon'
                                                       units flagged for FBA but still sitting on a normal shelf, i.e. the ones that
                                                       have to be gathered onto the C3-Amazon shelf for the next FBA shipment. These
                                                       are '#FREE' rows — no customer order behind them at all, which is why this mode
                                                       cannot live inside the Customer Orders grid.

!! NO `qty > 0` TEST ON EITHER LIST, AND THAT IS DELIBERATE. !!
Picking writes `localstock.qty` (see POST /pick-action): 0 = picked, -1 = not found, -2 = re-stock. All three are <= 0, so all three
drop the unit out of sellable stock (CLAUDE.md: sellable = `ordernum='#FREE' AND deleted=0 AND qty>0`). If this route filtered them
out, a row would vanish the instant it was actioned and Unpick would be unreachable. The legacy screen kept them for the same reason.
`state` below turns the qty into a word so the client never has to know the magic numbers.

The -1 / -2 markers are DISPLAY ONLY and go no further than this module (owner's call, 2026-08-30). Nothing downstream reads them:
`orderstatus.picknotfound` has never been 1 on a live or archived row, and utils/customerOrders.js derives its `picked` state from
"every held shelf row at qty = 0" — which a -1 row also satisfies. That is left exactly as it is; do not "fix" it from here.

AGE is days since the CUSTOMER ordered — the legacy screen's "Days" column, which it built by pulling `orderstatus.created` (TEXT)
back through the join. Taken off `orderstatus.createddate` (a real DATE) instead and differenced IN SQL, because a pg DATE handed to
JS becomes local midnight and shifts a day back under BST (CLAUDE.md). Amazon rows have no order, so age is null.

JOINS are all LEFT and all one-row: colour off skusummary, human title off `title` (skusummary.colour is an overloaded segmentation
tag, CLAUDE.md), barcode off skumap, fnsku/sku off amzfeed, and the order via a LATERAL — `orderstatus` has one row per physical unit
so an ordernum can match several rows and a plain join would multiply the list. No N+1: one query per mode.

BARCODE: skumap.ean carries a legacy trailing 'B' (an Excel guard). Stripped for display here — but only when it is actually there,
where the legacy did an unconditional Mid(1, Len-1) that ate a real digit off any row that had already been cleaned.
=======================================================================================================================================
Request Query Params:
  mode  (string, optional)  'shopify' (default) | 'amazon'
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "mode": "shopify",
  "counts": { "shopify": 9, "amazon": 6 },   // OUTSTANDING rows per mode (qty > 0) — the tab badges, both modes, every call
  "total": 9,                                 // rows returned for the requested mode, actioned ones included
  "outstanding": 9,
  "rows": [
    { "id": "WS7-4433-LX9YE", "code": "0745531-GIZEH-37", "groupid": "0745531-GIZEH", "size": "37",
      "qty": 1, "state": "waiting", "ordernum": "BC19151", "location": "C3-Back-13", "brand": "Birkenstock",
      "colour": "White", "title": "Birkenstock Gizeh White", "barcode": "4066651234567", "fnsku": null, "amzsku": null,
      "age_days": 1, "packed": false, "allocated": "unallocated" }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"INVALID_MODE"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { PICK_MODES, modeFilter, qtyState } = require('../utils/pick');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const mode = String(req.query.mode || 'shopify').toLowerCase();
    if (!PICK_MODES.includes(mode)) {
      return res.json({ return_code: 'INVALID_MODE', message: `mode must be one of: ${PICK_MODES.join(', ')}` });
    }

    // ORDER BY location, code is the legacy sort and it is not cosmetic — it is the order you walk the racks in.
    const rows = await query(`
      SELECT ls.id, ls.code, ls.groupid, ls.qty, ls.ordernum, ls.brand, ls.location, ls.allocated,
             RIGHT(ls.code, 2) AS size,
             ss.colour,
             t.shopifytitle AS title,
             CASE WHEN sm.ean LIKE '%B' THEN LEFT(sm.ean, LENGTH(sm.ean) - 1) ELSE sm.ean END AS barcode,
             af.fnsku, af.sku AS amzsku,
             o.batch, o.shippingname,
             (CURRENT_DATE - o.createddate)::int AS age_days
        FROM localstock ls
        LEFT JOIN skusummary ss ON ss.groupid = ls.groupid
        LEFT JOIN title t       ON t.groupid = ls.groupid
        LEFT JOIN skumap sm     ON sm.code = ls.code
        LEFT JOIN LATERAL (
          SELECT a.fnsku, a.sku FROM amzfeed a WHERE a.code = ls.code LIMIT 1
        ) af ON true
        LEFT JOIN LATERAL (
          SELECT os.batch, os.shippingname, os.createddate
            FROM orderstatus os
           WHERE os.ordernum = ls.ordernum AND ls.ordernum <> '#FREE'
           LIMIT 1
        ) o ON true
       WHERE ${modeFilter(mode, 'ls')}
       ORDER BY ls.location, ls.code
    `);

    // Both badge counts in one round trip, so switching tabs never shows a stale number on the tab you just left. Outstanding only
    // (qty > 0): an already-picked row is on the list to be undone, not to be worked.
    const counts = await query(`
      SELECT
        COUNT(*) FILTER (WHERE ${modeFilter('shopify', 'ls')} AND ls.qty > 0)::int AS shopify,
        COUNT(*) FILTER (WHERE ${modeFilter('amazon', 'ls')} AND ls.qty > 0)::int AS amazon
      FROM localstock ls
    `);

    const out = rows.rows.map((r) => ({
      id: r.id,
      code: r.code,
      groupid: r.groupid,
      size: r.size,
      qty: Number(r.qty),
      state: qtyState(r.qty),
      ordernum: r.ordernum,
      location: r.location,
      brand: r.brand || null,
      colour: r.colour || null,
      title: r.title || null,
      barcode: r.barcode || null,
      fnsku: r.fnsku || null,
      amzsku: r.amzsku || null,
      shippingname: r.shippingname || null,
      age_days: r.age_days === null ? null : Number(r.age_days),
      // batch '2' = boxed, the legacy "already packed" flag (see utils/customerOrders.js for the evidence behind it).
      packed: String(r.batch || '') === '2',
      allocated: r.allocated || null,
    }));

    return res.json({
      return_code: 'SUCCESS',
      mode,
      counts: counts.rows[0],
      total: out.length,
      outstanding: out.filter((r) => r.qty > 0).length,
      rows: out,
    });
  } catch (err) {
    logger.error('[pick-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the pick list' });
  }
});

module.exports = router;
