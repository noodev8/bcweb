/*
=======================================================================================================================================
API Route: shopify_dont_order_set
=======================================================================================================================================
Method: POST
Purpose: "Don't order" one SIZE on Shopify Order's Sellers view (owner, 2026-10-27 — "some are duds and I don't want to order anyway").
         Takes the size out of the Missed preset and the Daily Ordering count; it stays on the All / Low views, dimmed, with Undo
         (/shopify-dont-order-clear). Lapses on its own when the size sells again on Shopify — read in routes/shopify-sellers-list.js,
         nothing to clear (migrations/20261027_shopify_dont_order.sql). Deliberately NOT "Can't get it" (a style-wide supplier fact
         that also hides Amazon Order and comes back after three months).
         Upserts: marking an already-marked (or lapsed) size restamps it today, so a dud that sold once more can be marked again.
         One bclog row (section "Don't order"). Touches nothing else — no stock, no order line, no price.
=======================================================================================================================================
Request Payload:
{ "code": "M378BS-09" }

Success Response:
{ "return_code": "SUCCESS", "code": "M378BS-09" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"          // no live skumap size with that code
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

    const found = await withTransaction(async (client) => {
      // Only a real, live size can be marked — a typo'd code would otherwise sit in the table forever, matching nothing.
      const sku = await client.query('SELECT 1 FROM skumap WHERE code = $1 AND COALESCE(deleted,0) = 0', [code]);
      if (sku.rowCount === 0) return false;
      await client.query(`
        INSERT INTO shopify_dont_order (code, marked_at, marked_by) VALUES ($1, now(), $2)
        ON CONFLICT (code) DO UPDATE SET marked_at = EXCLUDED.marked_at, marked_by = EXCLUDED.marked_by
      `, [code, who]);
      await writeBcLog(client, { who, section: "Don't order", log: `Shopify size marked don't order: ${code}` });
      return true;
    });

    if (!found) return res.json({ return_code: 'NOT_FOUND', message: `No live size ${code}` });
    logger.info(`[shopify-dont-order-set] ${code} by ${who}`);
    return res.json({ return_code: 'SUCCESS', code });
  } catch (err) {
    logger.error('[shopify-dont-order-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the size' });
  }
});

module.exports = router;
