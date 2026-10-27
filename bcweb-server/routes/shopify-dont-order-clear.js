/*
=======================================================================================================================================
API Route: shopify_dont_order_clear
=======================================================================================================================================
Method: POST
Purpose: UNDO "Don't order" on one size (routes/shopify-dont-order-set.js) — deletes its shopify_dont_order row, so the size counts
         towards Missed again. Idempotent: a size with no mark changes nothing and logs nothing. A mark that has lapsed (the size sold
         again) is already ignored by the list; clearing it just tidies the row away.
=======================================================================================================================================
Request Payload:
{ "code": "M378BS-09" }

Success Response:
{ "return_code": "SUCCESS", "cleared": true }   // false when there was no mark
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
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const code = String((req.body || {}).code || '').trim();
    if (!code) return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    const who = req.user.display_name;

    const cleared = await withTransaction(async (client) => {
      const del = await client.query('DELETE FROM shopify_dont_order WHERE code = $1', [code]);
      if (del.rowCount === 0) return false;
      await writeBcLog(client, { who, section: "Don't order", log: `Shopify size don't order undone: ${code}` });
      return true;
    });

    if (cleared) logger.info(`[shopify-dont-order-clear] ${code} by ${who}`);
    return res.json({ return_code: 'SUCCESS', cleared });
  } catch (err) {
    logger.error('[shopify-dont-order-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to undo' });
  }
});

module.exports = router;
