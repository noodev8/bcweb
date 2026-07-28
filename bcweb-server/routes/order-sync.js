/*
=======================================================================================================================================
API Route: order_sync
=======================================================================================================================================
Method: POST
Purpose: The "Sync orders" button on Analytics -> Sales. Pulls unfulfilled orders from Shopify and runs the whole order pipeline —
         order sync, sale booking, archiving, pick allocation and housekeeping — exactly as the cron does, on demand.

         !! THE BUSINESS LOGIC THIS ROUTE DRIVES ALSO EXISTS AS C:\scripts\orders\update_orders.py, WHICH IS STILL IN CRON. !!
         Read the banner at the top of utils/orderSync.js before changing anything either side. Both are live.

SHAPE. Two steps, deliberately separated:
    1. FETCH   — outside any transaction. Network work must not hold a database transaction open, and a Shopify failure must leave the
                 database completely untouched rather than rolling one back.
    2. WRITE   — one withTransaction around all six phases. A run either lands completely or not at all, which is what the Python's
                 single commit-at-the-end achieves.

THE ARCHIVE GUARD. Phase C decides what to archive by ABSENCE from the fetched order list. If the fetch was truncated, that logic
would archive live orders wholesale — so `truncated` is passed through and the phase is skipped entirely rather than run on partial
data. The Python has no such guard: it sends limit=250, never paginates, and archives on whatever came back.

WHAT IT LEAVES ALONE. Nothing here touches Amazon rows (ordertype 3 is excluded from pick allocation) or, in practice, the Order
Status module's local rows — see the SCOPE NOTE in utils/orderSync.js for exactly why that holds and what would break it.
=======================================================================================================================================
Request: no body.

Success Response:
{ "return_code": "SUCCESS",
  "fetched": { "orders": 41, "pages": 1, "truncated": false },
  "summary": { "orders": {...}, "sales": {...}, "archive": {...}, "picks": {...}, "housekeeping": {...}, "notes": [...] },
  "headline": "+3 orders" }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "SHOPIFY_NOT_CONFIGURED" · "SHOPIFY_FETCH_FAILED" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { isConfigured, fetchUnfulfilledOrders } = require('../utils/shopifyOrders');
const { runFullSync } = require('../utils/orderSync');
const logger = require('../utils/logger');

router.use(verifyToken);

/*
 * headlineOf(summary) -> 'the one line the button shows'
 * Only the parts that actually moved, so a quiet run reads "Up to date" instead of a row of zeros. Also feeds the bclog audit row
 * (varchar(500)), which is what /order-sync-last reads back for the "last run" stamp.
 */
function headlineOf(s) {
  return s.orders.inserted
    ? `+${s.orders.inserted} order${s.orders.inserted === 1 ? '' : 's'}`
    : 'Up to date';
}

router.post('/', async (req, res) => {
  try {
    // Fail before the network call, with the name of the missing variable rather than a 401 out of Shopify. This is a DIFFERENT token
    // from SHOPIFY_ACCESS_TOKEN (that one is write_products; this one needs read_orders) — see config/config.js.
    if (!isConfigured()) {
      return res.json({
        return_code: 'SHOPIFY_NOT_CONFIGURED',
        message: 'Order sync needs SHOPIFY_SHOP and SHOPIFY_ORDERS_ACCESS_TOKEN in bcweb-server/.env'
      });
    }

    // --- STEP 1: fetch (no transaction held) -----------------------------------------------------------------------------------
    let fetched;
    try {
      fetched = await fetchUnfulfilledOrders();
    } catch (err) {
      logger.error('[order-sync] fetch failed:', err.message);
      return res.json({
        return_code: err.code === 'SHOPIFY_NOT_CONFIGURED' ? 'SHOPIFY_NOT_CONFIGURED' : 'SHOPIFY_FETCH_FAILED',
        message: `${err.message} — nothing was written`
      });
    }

    // --- STEP 2: write (all six phases, one transaction) -----------------------------------------------------------------------
    const summary = await withTransaction(async (client) => {
      const result = await runFullSync(client, fetched.orders, { truncated: fetched.truncated });

      // Audit row, same bclog shape the Update Amazon module and the Inventory adjustments use. created_at is UTC; the date/time text
      // stamps are Europe/London for the legacy PowerBuilder log view.
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Order Sync', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [req.user.display_name, `Order Sync: ${headlineOf(result)}`.slice(0, 500)]
      );

      return result;
    });

    logger.info(
      `[order-sync] ${req.user.display_name}: ${fetched.orders.length} orders fetched (${fetched.pages} page(s)` +
      `${fetched.truncated ? ', TRUNCATED' : ''}) -> +${summary.orders.inserted} orderstatus, ${summary.orders.updated} updated, ` +
      `+${summary.sales.inserted} sales, ${summary.archive.archived} archived, ${summary.picks.picksTaken} picks ` +
      `(${summary.picks.splits} splits), ${summary.archive.picksRemoved} done picks removed`
    );

    return res.json({
      return_code: 'SUCCESS',
      fetched: { orders: fetched.orders.length, pages: fetched.pages, truncated: fetched.truncated },
      summary,
      headline: headlineOf(summary)
    });
  } catch (err) {
    logger.error('[order-sync] error:', err.message);
    // The transaction rolled back, so this is genuinely "nothing changed" — say so, because the operator's next move is to press it
    // again and they need to know that is safe.
    return res.json({ return_code: 'SERVER_ERROR', message: 'Order sync failed — nothing was written. Safe to try again.' });
  }
});

module.exports = router;
