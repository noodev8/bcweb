/*
=======================================================================================================================================
API Route: order_status_adjust_qty
=======================================================================================================================================
Method: POST
Purpose: +/- the unit count for one SKU/size within an existing order batch (CLAUDE.md Order Status module — "allow +/- when it
         comes to the editing part"). `orderstatus` has one row per physical unit (qty always 1, duplicated lines), so "add 2" means
         insert 2 new rows and "remove 1" means delete 1.

Add: duplicates one of the group's own existing rows (client sends every `ordernum` currently in that SKU/size group — it already
has this from the grouped list) via INSERT ... SELECT, overriding only `ordernum` (freshly minted, crypto.randomUUID-based — free
unique value per orders-spec.md, no legacy scheme to replicate) and forcing `arrived=0`/`arriveddate=NULL` on the copy. Everything
else (supplier, ordertype, createddate, ponumber, fnsku, batch, channel, ukd/othersupplier, ...) comes straight off the template row,
so the new units land in the exact same batch/PO context automatically — no separate lookups needed.

Remove: archives+deletes up to `abs(delta)` of the given ordernums, WAITING units first, falling back to ARRIVED ones once the waiting
units run out — so repeatedly pressing "-" walks a row down to zero regardless of arrival status, without the operator having to
switch to the checkbox+Archive path just because a unit already arrived (owner: "feels cleaner to press - ... rather than having to
move the mouse all the way over"). Archived first (same archive-then-delete pattern as POST /order-status-archive) so it's recoverable.
=======================================================================================================================================
Request Payload:
{
  "ordernums": ["AMZ-O-WS7-...", ...],  // required — every ordernum currently in this SKU/size group
  "delta": 2                            // required, non-zero integer. Positive = add units, negative = remove waiting units.
}

Success Response:
{ "return_code": "SUCCESS", "added": 2, "removed": 0, "qty": 7, "arrived": 0, "waiting": 7 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Cap a single adjustment so a typo (e.g. an extra zero) can't insert/delete a large number of rows in one call.
const MAX_DELTA = 200;

// Every orderstatus column except ordernum (freshly minted per new row) and arrived/arriveddate (forced to "just added" on a copy).
const TEMPLATE_COLS = `shopifysku, qty, updated, created, batch, supplier, title, shippingname, postcode, address1, address2,
  company, city, county, country, phone, shippingnotes, orderdate, ukd, localstock, amz, othersupplier, fnsku, weight, pickedqty,
  email, courier, courierfixed, customerwaiting, notorderamz, alloworder, searchalt, channel, picknotfound, fbaordered, notes,
  shopcustomer, shippingcost, ordertype, ponumber, createddate`;

const ARCHIVE_COLS = `ordernum, ${TEMPLATE_COLS}, arrived, arriveddate`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { ordernums } = body;
    const delta = Number(body.delta);

    if (!Array.isArray(ordernums) || ordernums.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernums must be a non-empty array' });
    }
    const cleanIds = Array.from(new Set(
      ordernums.filter((o) => typeof o === 'string' && o.trim() !== '').map((o) => o.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernums must contain at least one valid order id' });
    }
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `delta must be a non-zero integer, at most ${MAX_DELTA} in magnitude` });
    }

    const result = await withTransaction(async (client) => {
      // Template row identifies the group (shopifysku/supplier/ordertype/createddate) for the final recount below.
      const template = await client.query(
        `SELECT shopifysku, supplier, ordertype, createddate FROM orderstatus WHERE ordernum = ANY($1::text[]) LIMIT 1`,
        [cleanIds]
      );
      if (template.rows.length === 0) return null; // none of the given ordernums exist any more (race with another operator)
      const { shopifysku, supplier, ordertype, createddate } = template.rows[0];

      let added = 0;
      let removed = 0;

      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          const ordernum = `WEB-ADJ-${crypto.randomUUID()}`;
          await client.query(
            `INSERT INTO orderstatus (ordernum, ${TEMPLATE_COLS}, arrived, arriveddate)
             SELECT $1, ${TEMPLATE_COLS}, 0, NULL FROM orderstatus WHERE ordernum = $2`,
            [ordernum, cleanIds[0]]
          );
        }
        added = delta;
      } else {
        const wantRemove = Math.abs(delta);
        // Waiting units first (COALESCE(arrived,0) ASC puts 0 before 1), arrived units only once waiting ones are exhausted.
        const pick = await client.query(
          `SELECT ordernum FROM orderstatus WHERE ordernum = ANY($1::text[]) ORDER BY COALESCE(arrived,0) ASC LIMIT $2`,
          [cleanIds, wantRemove]
        );
        const toRemove = pick.rows.map((r) => r.ordernum);
        if (toRemove.length > 0) {
          await client.query(
            `INSERT INTO orderstatus_archive (${ARCHIVE_COLS}, archivedate)
             SELECT ${ARCHIVE_COLS}, CURRENT_DATE FROM orderstatus WHERE ordernum = ANY($1::text[])`,
            [toRemove]
          );
          const del = await client.query('DELETE FROM orderstatus WHERE ordernum = ANY($1::text[])', [toRemove]);
          removed = del.rowCount;
        }
      }

      const totals = await client.query(
        `SELECT COUNT(*) AS qty, SUM(CASE WHEN COALESCE(arrived,0) > 0 THEN 1 ELSE 0 END) AS arrived
         FROM orderstatus WHERE shopifysku = $1 AND supplier = $2 AND ordertype = $3 AND createddate = $4`,
        [shopifysku, supplier, ordertype, createddate]
      );
      const qty = Number(totals.rows[0].qty) || 0;
      const arrived = Number(totals.rows[0].arrived) || 0;

      return { added, removed, qty, arrived, waiting: qty - arrived };
    });

    if (result === null) {
      return res.json({ return_code: 'NOT_FOUND', message: 'None of the given orders exist any more' });
    }
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[order-status-adjust-qty] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to adjust quantity' });
  }
});

module.exports = router;
