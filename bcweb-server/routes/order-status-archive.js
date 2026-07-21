/*
=======================================================================================================================================
API Route: order_status_archive
=======================================================================================================================================
Method: POST
Purpose: Remove a hand-picked set of orderstatus rows — a whole batch, or a subset of its lines — from the live table, moving them
         into `orderstatus_archive` first so nothing is silently lost. This is the operator's manual equivalent of the legacy
         auto-cleanup scripts (update_orders2.py / clean_sales.sql, docs/order-status-lifecycle.docx), used for orders the operator
         has decided are done with (fully arrived and reconciled, or judged as never arriving) before the automatic window catches up.

Works regardless of arrived status — the operator may want to tidy an already-arrived batch early, or write off a stuck one. For a
supplier-wide age-based sweep (only "waiting" rows past an age threshold) see POST /order-status-clear-stale instead; this route is
always an explicit list of `ordernum`s.

`orderstatus_archive` already exists in the schema (same columns as orderstatus plus `archivedate`) and is otherwise unused by this
app, so it is reused rather than creating a new table. Archive-then-delete runs in one `withTransaction` so a row is never lost
between the two steps.
=======================================================================================================================================
Request Payload:
{ "ordernums": ["AMZ-O-WS7-4515", ...] }  // required, non-empty, <= 1000

Success Response:
{ "return_code": "SUCCESS", "archived": 5 }
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

// Explicit column list (orderstatus minus `last_seen`, which orderstatus_archive doesn't carry) so the archive copy never silently
// breaks if either table's column order ever drifts — never rely on SELECT * matching across two tables.
const COLS = `ordernum, shopifysku, qty, updated, created, batch, supplier, title, shippingname, postcode, address1, address2,
  company, city, county, country, phone, shippingnotes, orderdate, ukd, localstock, amz, othersupplier, fnsku, weight, pickedqty,
  email, courier, courierfixed, customerwaiting, notorderamz, alloworder, searchalt, channel, picknotfound, fbaordered, notes,
  shopcustomer, shippingcost, ordertype, ponumber, createddate, arrived, arriveddate`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { ordernums } = body;

    if (!Array.isArray(ordernums) || ordernums.length === 0 || ordernums.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `ordernums must be a non-empty array of at most ${MAX_IDS} order ids` });
    }
    const cleanIds = Array.from(new Set(
      ordernums.filter((o) => typeof o === 'string' && o.trim() !== '').map((o) => o.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernums must contain at least one valid order id' });
    }

    const archived = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO orderstatus_archive (${COLS}, archivedate)
         SELECT ${COLS}, CURRENT_DATE FROM orderstatus WHERE ordernum = ANY($1::text[]) AND ordertype IN (2,3)`,
        [cleanIds]
      );
      const del = await client.query(
        `DELETE FROM orderstatus WHERE ordernum = ANY($1::text[]) AND ordertype IN (2,3)`,
        [cleanIds]
      );
      return del.rowCount;
    });

    return res.json({ return_code: 'SUCCESS', archived });
  } catch (err) {
    logger.error('[order-status-archive] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to archive orders' });
  }
});

module.exports = router;
