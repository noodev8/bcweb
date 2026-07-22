/*
=======================================================================================================================================
API Route: order_status_place
=======================================================================================================================================
Method: POST
Purpose: THE WRITE that turns "chosen" into "on order" — stamp `orderdate` on a selection of orderstatus rows once the operator has
         actually put the order into the supplier's system. This is the marker the whole module hangs off (utils/orderStatus.js): before
         it the goods are only a shortlist, after it they're a delivery to chase.

Mirrors what the legacy PowerBuilder app does when an order is confirmed, so a web-placed row is indistinguishable from a legacy one to
every existing report and script:
  - `orderdate` = now in the legacy 'YYYYMMDD HH24:MI:SS' text format, Europe/London wall clock (NOT a real timestamp — the column is
    character varying; see the schema landmines in CLAUDE.md).
  - `updated`   = the same stamp (the legacy app always moves both together).
  - `ponumber`  = a generated 'BC-YYYYMMDD-NNN' reference (utils/orderStatus.js -> nextPoNumber). Every unit in one placement shares it,
    so the ON ORDER screen can group the delivery and the operator has a reference to quote when chasing the supplier. The 'BC-' prefix
    keeps ours disjoint from the legacy 6-digit supplier-allocated numbers, and is also what makes the undo below safe.

We do NOT touch `arrived`/`arriveddate` — goods-in stays with the legacy app (docs/orders/orders-spec.md §7b), and we insert no rows and
move no stock. Placing an order is purely this stamp.

IDEMPOTENCE / RACE SAFETY: the UPDATE carries `AND COALESCE(orderdate,'') = ''` in its WHERE, so a double-click, a retry, or a second
operator working the same supplier can only ever stamp rows that are still un-placed. Already-placed rows are skipped rather than
re-stamped (which would otherwise reset their delivery age and lose the original PO). `placed: 0` means someone got there first — the
route reports NOT_FOUND rather than pretending it wrote something.
=======================================================================================================================================
Request Payload:
{ "ordernums": ["AMZ-O-WS1-2063", ...] }  // required, non-empty, <= 1000. Every unit to place — the UI sends the ordernums behind the
                                          // ticked SKU rows (a partial selection is normal: untick a size the supplier can't fulfil
                                          // and it simply stays in the TO PLACE queue for next time).

Success Response:
{ "return_code": "SUCCESS", "placed": 12, "ponumber": "BC-20260722-001", "orderdate": "20260722 14:03:07", "placed_time": "14:03" }
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
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LEGACY_STAMP, nextPoNumber, notPlaced } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_IDS = 1000;

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

    const result = await withTransaction(async (client) => {
      // Minted inside the transaction (it takes an advisory lock) so concurrent placements can't share a reference. If the UPDATE
      // below turns out to match nothing, the whole thing rolls back and the number is simply never used — gaps in the daily sequence
      // are harmless, duplicates would not be.
      const ponumber = await nextPoNumber(client);

      // ordertype IN (2,3) keeps customer orders (type 1) untouchable through this route, and arrived=0 refuses to "place" something
      // that has somehow already landed. RETURNING gives us the true count of rows this call actually changed.
      const upd = await client.query(`
        UPDATE orderstatus o
           SET orderdate = ${LEGACY_STAMP},
               updated   = ${LEGACY_STAMP},
               ponumber  = $2
         WHERE o.ordernum = ANY($1::text[])
           AND o.ordertype IN (2,3)
           AND COALESCE(o.arrived,0) = 0
           AND ${notPlaced()}
        RETURNING o.ordernum, o.orderdate
      `, [cleanIds, ponumber]);

      if (upd.rowCount === 0) return null;
      return { placed: upd.rowCount, ponumber, orderdate: upd.rows[0].orderdate };
    });

    if (result === null) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Nothing left to place — these units were already ordered or have arrived' });
    }

    // 'YYYYMMDD HH24:MI:SS' -> 'HH:MM' for the confirmation line; the raw stamp is returned too for the undo path.
    const placedTime = (result.orderdate || '').slice(9, 14);
    logger.info(`[order-status-place] ${result.placed} unit(s) placed as ${result.ponumber} by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', ...result, placed_time: placedTime });
  } catch (err) {
    logger.error('[order-status-place] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to place the order' });
  }
});

module.exports = router;
