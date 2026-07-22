/*
=======================================================================================================================================
API Route: order_status_unplace
=======================================================================================================================================
Method: POST
Purpose: Undo a placement — put rows back into the TO PLACE queue after a mis-click, by clearing the `orderdate` stamp that POST
         /order-status-place wrote. The UI offers this straight after placing ("Placed 12 as BC-20260722-001 · Undo").

Needed because placing is a two-step flow the app can't fully see: you download the CSV, then push it into the supplier's system
OUTSIDE this app, then come back and mark it ordered. If that submission bounces, the stamp is wrong and there has to be a way back —
without one the only recovery would be hand-editing the live production table.

SAFETY RAIL — `ponumber LIKE 'BC-%'`: this route will only unplace an order THIS APP placed. Orders confirmed in the legacy
PowerBuilder app carry a supplier-allocated 6-digit ponumber ('158807') and are deliberately out of reach, so a stray call can never
un-order something the app has no record of placing and whose delivery is genuinely in flight. Combined with the placed() predicate,
the operation is naturally idempotent: a second call finds nothing to clear and reports NOT_FOUND.

`orderdate` is reset to the EMPTY STRING, not NULL — that's how the legacy app represents "not ordered yet" (CLAUDE.md landmine), and
anything reading `IS NULL` would miss a NULL-ed row entirely. `ponumber` is cleared with it: the reference described an order that no
longer exists, and leaving it behind would let a later placement's row share a PO with a cancelled one.
=======================================================================================================================================
Request Payload:
{ "ordernums": ["AMZ-O-WS1-2063", ...] }  // required, non-empty, <= 1000

Success Response:
{ "return_code": "SUCCESS", "unplaced": 12 }
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
const { LEGACY_STAMP, PO_PREFIX, placed } = require('../utils/orderStatus');
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

    const unplaced = await withTransaction(async (client) => {
      // arrived=0 as well: once units have landed, un-ordering them would leave stock in the building that nothing claims to have
      // bought. `updated` still moves, because the row genuinely changed.
      const upd = await client.query(`
        UPDATE orderstatus o
           SET orderdate = '',
               ponumber  = NULL,
               updated   = ${LEGACY_STAMP}
         WHERE o.ordernum = ANY($1::text[])
           AND o.ordertype IN (2,3)
           AND COALESCE(o.arrived,0) = 0
           AND ${placed()}
           AND o.ponumber LIKE '${PO_PREFIX}%'
      `, [cleanIds]);
      return upd.rowCount;
    });

    if (unplaced === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Nothing to undo — these units were not placed from here, or have arrived' });
    }

    logger.info(`[order-status-unplace] ${unplaced} unit(s) returned to the queue by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', unplaced });
  } catch (err) {
    logger.error('[order-status-unplace] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to undo the placement' });
  }
});

module.exports = router;
