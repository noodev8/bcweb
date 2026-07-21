/*
=======================================================================================================================================
API Route: order_status_switch_type
=======================================================================================================================================
Method: POST
Purpose: Re-flag a set of orderstatus rows from one supplier-order type to the other (local <-> Amazon), for the case where an order
         was logged under the wrong type and needs correcting without re-entering it. Operates on an explicit list of `ordernum`s so
         it works equally for a whole batch (client sends every line in the batch) or a hand-picked subset of sizes within it.

Only flips `ordertype` (2 <-> 3). `ukd` / `othersupplier` / `amz` are supplier-identity flags (which supplier placed it), not
order-type flags — live data confirms they track `supplier`, not `ordertype` (see CLAUDE.md-adjacent research), and a type switch
never changes the supplier, so they are left untouched. `ordernum` (e.g. "LOCAL-..." / "AMZ-O-...") is also left as-is: per
docs/orders/orders-spec.md the prefix is legacy cosmetic convention only, superseded by the `ordertype` column — nothing branches on
it, so a "LOCAL-" row that is now ordertype=3 is not a functional problem, just a slightly stale label.
=======================================================================================================================================
Request Payload:
{
  "ordernums": ["AMZ-O-WS7-4515", ...],  // required, non-empty, <= 500
  "newOrderType": 3                       // required, 2 (local) or 3 (amazon)
}

Success Response:
{ "return_code": "SUCCESS", "updated": 5 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_ORDER_TYPE"
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

const MAX_IDS = 500;

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

    const newOrderType = Number(body.newOrderType);
    if (newOrderType !== 2 && newOrderType !== 3) {
      return res.json({ return_code: 'INVALID_ORDER_TYPE', message: 'newOrderType must be 2 (local) or 3 (amazon)' });
    }

    // Only re-flag rows that are already a supplier order (2 or 3) — never touch customer orders (ordertype=1) even if an id somehow
    // collided, since this endpoint is the Order Status module's action, not a general orderstatus editor.
    const result = await withTransaction((client) =>
      client.query(
        `UPDATE orderstatus SET ordertype = $2
         WHERE ordernum = ANY($1::text[]) AND ordertype IN (2,3)`,
        [cleanIds, newOrderType]
      )
    );

    return res.json({ return_code: 'SUCCESS', updated: result.rowCount });
  } catch (err) {
    logger.error('[order-status-switch-type] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to switch order type' });
  }
});

module.exports = router;
