/*
=======================================================================================================================================
API Route: shopify_order_no_supply_clear
=======================================================================================================================================
Method: POST
Purpose: Take "Can't get it" off a style (routes/shopify-order-no-supply.js) — all three no_supply_* columns back to NULL. Called:
           - from the "Couldn't get it — 26 Sep" note a style carries once its park has lapsed (the operator's "yes, I can get it"),
           - from a still-parked style's own Clear, when the supplier comes back early,
           - by Shopify Order after Confirm Basket lands an order line for a flagged style — a style you've just ordered is plainly
             one you can get, so the note would only be noise.
         Idempotent: clearing a style that carries no flag is a SUCCESS that changes nothing. Touches nothing else on skusummary.
=======================================================================================================================================
Request Payload:
{ "groupid": "0034791-MILANO" }   // required

Success Response:
{ "return_code": "SUCCESS", "groupid": "0034791-MILANO" }
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
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const groupid = typeof (req.body || {}).groupid === 'string' ? req.body.groupid.trim() : '';
    if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });

    const result = await withTransaction(async (client) => client.query(`
      UPDATE skusummary
         SET no_supply_since = NULL, no_supply_until = NULL, no_supply_by = NULL
       WHERE groupid = $1
       RETURNING groupid
    `, [groupid]));

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `${groupid} isn't a style` });
    }
    logger.info(`[shopify-order-no-supply-clear] ${groupid} cleared by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', groupid });
  } catch (err) {
    logger.error('[shopify-order-no-supply-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to clear the style' });
  }
});

module.exports = router;
