/*
=======================================================================================================================================
API Route: order_status_restore
=======================================================================================================================================
Method: POST
Purpose: The undo half of archiving — move explicit `orderstatus_archive` rows back into `orderstatus`, unchanged.

Why it exists: pressing "−" on a line walks it down to zero, and the last press takes the line off the screen entirely. That felt
abrupt, so the UI now KEEPS a zeroed line in place showing 0 and offers "+" to bring it back (owner, 2026-07-22). "+" can't go through
/order-status-adjust-qty for a zeroed line: that route ADDs by cloning one of the group's own surviving rows, and at zero there is
nothing left to clone. The removed units aren't lost though — adjust-qty archives before it deletes — so the honest restore is to move
the exact archived rows back, which also returns them with every legacy column intact: same batch, same `orderdate`, same `ponumber`,
same arrived state. A clone could not have reproduced that.

Scope guards:
  - Rows are addressed by (ordernum, code) — the FULL primary key of both tables is (ordernum, shopifysku), and `ordernum` alone is
    NOT unique: the archive holds 200 ordernums that cover several SKUs (legacy multi-line customer orders). Matching on ordernum
    alone would resurrect every SKU filed under that number, not the one unit the operator removed. The client always knows the code —
    it's the line it was standing on — so it passes it and we match the real key.
  - `ordertype IN (2,3)` only, matching /order-status-archive: this module never touches customer orders (ordertype 1).
  - A row already live in `orderstatus` is skipped (NOT EXISTS on the same full key), so a double-click or a retry restores once
    rather than creating a duplicate unit — and only the rows actually restored are then removed from the archive.
No date limit: an undo the next morning is still an undo.

Note: `orderstatus.last_seen` has no counterpart in `orderstatus_archive`, so it isn't carried back (same asymmetry the archive write
has, in reverse) — it's a housekeeping stamp, not order data.
=======================================================================================================================================
Request Payload:
{
  "ordernums": ["WEB-ADJ-...", ...],  // required — the archived order ids to bring back
  "code": "FLE030-IVES-WHITE-38"      // required — the SKU (orderstatus.shopifysku) those ids belong to; completes the key
}

Success Response:
{ "return_code": "SUCCESS", "restored": 1 }
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
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_IDS = 1000;

// Explicit column list (the archive's columns minus `archivedate`, which is the archive's own bookkeeping) — never SELECT * across
// two tables whose column order could drift.
const COLS = `ordernum, shopifysku, qty, updated, created, batch, supplier, title, shippingname, postcode, address1, address2,
  company, city, county, country, phone, shippingnotes, orderdate, ukd, localstock, amz, othersupplier, fnsku, weight, pickedqty,
  email, courier, courierfixed, customerwaiting, notorderamz, alloworder, searchalt, channel, picknotfound, fbaordered, notes,
  shopcustomer, shippingcost, ordertype, ponumber, createddate, arrived, arriveddate`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { ordernums } = body;
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    if (!Array.isArray(ordernums) || ordernums.length === 0 || ordernums.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `ordernums must be a non-empty array of at most ${MAX_IDS} order ids` });
    }
    const cleanIds = Array.from(new Set(
      ordernums.filter((o) => typeof o === 'string' && o.trim() !== '').map((o) => o.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernums must contain at least one valid order id' });
    }
    if (code === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code (the SKU these orders belong to) is required' });
    }

    const restored = await withTransaction(async (client) => {
      // INSERT ... RETURNING tells us exactly which rows came back, so the archive delete below can't remove a row we skipped.
      const ins = await client.query(
        `INSERT INTO orderstatus (${COLS})
         SELECT ${COLS} FROM orderstatus_archive a
         WHERE a.ordernum = ANY($1::text[]) AND a.shopifysku = $2 AND a.ordertype IN (2,3)
           AND NOT EXISTS (
             SELECT 1 FROM orderstatus o WHERE o.ordernum = a.ordernum AND o.shopifysku = a.shopifysku
           )
         RETURNING ordernum`,
        [cleanIds, code]
      );
      const back = ins.rows.map((r) => r.ordernum);
      if (back.length > 0) {
        // Same full key on the way out — never sweep another SKU's archive row filed under the same ordernum.
        await client.query(
          'DELETE FROM orderstatus_archive WHERE ordernum = ANY($1::text[]) AND shopifysku = $2',
          [back, code]
        );
      }
      return back.length;
    });

    return res.json({ return_code: 'SUCCESS', restored });
  } catch (err) {
    logger.error('[order-status-restore] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to restore the removed units' });
  }
});

module.exports = router;
