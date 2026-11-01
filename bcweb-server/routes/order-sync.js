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

EBAY (2026-11-01, owner: the same button, not a separate one). eBay orders are fetched beside Shopify's (utils/ebayOrders.js, outside
the transaction) and written FIRST inside it (utils/ebayOrderSync.js), so phase E allocates them in the same press. eBay is SOFT: not
configured, or eBay down, and the Shopify run still happens — the headline says eBay wasn't checked. eBay has no Python twin and the
cron never fetches it, so eBay orders only arrive on a press. `ebay` in the response is null when eBay wasn't run.
=======================================================================================================================================
Request: no body.

Success Response:
{ "return_code": "SUCCESS",
  "fetched": { "orders": 41, "pages": 1, "truncated": false },
  "summary": { "orders": {...}, "sales": {...}, "archive": {...}, "picks": {...}, "housekeeping": {...}, "notes": [...] },
  "ebay": { "open": 2, "newOrders": 2, "inserted": 2, "updated": 0, "posted": 0, "cancelled": 0, "picksRemoved": 0, "picksFreed": 0,
            "linesWithoutSku": 0, "unresolved": 0, "truncated": false, "attention": false, "notes": [] } | null,
  "ebayError": "…" | null,
  "headline": "2 new orders · 2 new eBay" }  // or "No new orders"
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
const ebayOrders = require('../utils/ebayOrders');
const { syncEbayOrders } = require('../utils/ebayOrderSync');
const { query } = require('../database');
const logger = require('../utils/logger');

router.use(verifyToken);

/*
 * headlineOf(summary, ebay, ebayError) -> 'the one line the button shows'
 * Answers "were there any new orders?" (owner, 2026-09-25) — counted as distinct ORDERS, not orderstatus rows, so a 3-item order
 * reads "1 new order". "New" means new to our database: orders the cron (update_orders.py) already pulled in won't count again.
 * eBay adds its own part, because the button chip is the only place a run's outcome is shown: new eBay orders, and anything a person
 * must act on (a cancelled pair to put back, a missing Custom label) — the detail is in ebay.notes and the server log.
 * Also feeds the bclog audit row (varchar(500)), which is what /order-sync-last reads back for the "last run" stamp.
 */
function headlineOf(s, ebay, ebayError) {
  const n = s.orders.newOrders;
  const parts = [n ? `${n} new order${n === 1 ? '' : 's'}` : 'No new orders'];
  if (ebayError) parts.push('eBay not checked');
  else if (ebay) {
    if (ebay.newOrders) parts.push(`${ebay.newOrders} new eBay`);
    if (ebay.posted) parts.push(`${ebay.posted} eBay posted`);
    if (ebay.cancelled) parts.push(`${ebay.cancelled} eBay cancelled`);
    if (ebay.attention) parts.push('eBay: see notes');
  }
  return parts.join(' · ');
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

    // --- STEP 1b: eBay fetch (soft — a failure is reported, never fatal) -------------------------------------------------------
    // heldOrderIds = the EB orders we hold now, so ebayOrders can ask eBay what happened to any that left its open list.
    let ebayFetched = null;
    let ebayError = null;
    if (ebayOrders.isConfigured()) {
      try {
        const held = await query(`SELECT DISTINCT ordernum FROM orderstatus WHERE channel = 'EBAY'`);
        ebayFetched = await ebayOrders.fetchEbayOrders(held.rows.map((r) => String(r.ordernum).replace(/^EB/, '')));
      } catch (err) {
        ebayError = err.message;
        logger.error('[order-sync] eBay fetch failed (Shopify still runs):', err.message);
      }
    } else {
      ebayError = 'eBay is not set up on the server (EBAY_CLIENT_ID / _SECRET / EBAY_REFRESH_TOKEN)';
    }

    // --- STEP 2: write (eBay first, then all six phases, one transaction) ------------------------------------------------------
    let ebay = null;
    const summary = await withTransaction(async (client) => {
      // eBay BEFORE runFullSync, so phase E allocates the new eBay pairs in this same press.
      if (ebayFetched) ebay = await syncEbayOrders(client, ebayFetched);
      const result = await runFullSync(client, fetched.orders, { truncated: fetched.truncated });

      // Audit row, same bclog shape the Update Amazon module and the Inventory adjustments use. created_at is UTC; the date/time text
      // stamps are Europe/London for the legacy PowerBuilder log view.
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Order Sync', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [req.user.display_name, `Order Sync: ${headlineOf(result, ebay, ebayError)}`.slice(0, 500)]
      );

      return result;
    });

    if (ebay && ebay.notes.length) logger.error(`[order-sync] eBay notes: ${ebay.notes.join(' | ')}`);

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
      ebay,
      ebayError,
      headline: headlineOf(summary, ebay, ebayError)
    });
  } catch (err) {
    logger.error('[order-sync] error:', err.message);
    // The transaction rolled back, so this is genuinely "nothing changed" — say so, because the operator's next move is to press it
    // again and they need to know that is safe.
    return res.json({ return_code: 'SERVER_ERROR', message: 'Order sync failed — nothing was written. Safe to try again.' });
  }
});

module.exports = router;
