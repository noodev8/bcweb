/*
=======================================================================================================================================
API Route: order_sync
=======================================================================================================================================
Method: POST
Purpose: The "Update orders" button (Analytics -> Sales, Customer Orders, the dashboard tile, the manifest button). Runs the whole order
         run NOW — every sales channel (Shopify, eBay, …) read and written, picks allocated, housekeeping — rather than waiting for cron.

         All the logic is utils/orderSync.js → runOrderSync(), which the cron (scripts/order-sync.js) also calls. This route only adds
         the user and the response. See that file's header for the run, and utils/orderChannels.js for how a channel plugs in.

THE BUTTON SHOWS ONE LINE (owner, 2026-11-01: "Just the total number of orders without confusing the user"): `headline`, e.g.
"3 new orders", every channel together. A channel that couldn't be read is NOT mentioned on screen — it's in the server log and the
bclog row, and `channels` in the response says so for anyone who looks.
=======================================================================================================================================
Request: no body.

Success Response:
{ "return_code": "SUCCESS",
  "headline": "3 new orders",            // or "No new orders"
  "newOrders": 3,
  "channels": [ { "name": "Shopify", "checked": true, "error": null, "newOrders": 2, "log": "2 new, 2 sales, 1 archived", "detail": {...} },
                { "name": "eBay",    "checked": false, "error": "eBay answered HTTP 503", "newOrders": 0, "log": "not checked", "detail": null } ],
  "picks": { "considered": 4, "picksTaken": 3, ... },
  "housekeeping": { ... },
  "notes": [ "Shopify: BC18630 / X-38: no groupid in skumap — order recorded, sale NOT booked", ... ] }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "NO_CHANNEL_READ" (no channel could be read — nothing written) · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { runOrderSync } = require('../utils/orderSync');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const result = await runOrderSync({ by: req.user.display_name });
    return res.json({
      return_code: 'SUCCESS',
      headline: result.headline,
      newOrders: result.newOrders,
      channels: result.channels,
      picks: result.picks,
      housekeeping: result.housekeeping,
      notes: result.notes
    });
  } catch (err) {
    if (err.code === 'NO_CHANNEL_READ') {
      return res.json({ return_code: 'NO_CHANNEL_READ', message: 'Couldn\'t reach the sales channels — nothing was written. Try again in a minute.' });
    }
    logger.error('[order-sync] error:', err.message);
    // The transaction rolled back, so this is genuinely "nothing changed" — say so, because the operator's next move is to press it
    // again and they need to know that is safe.
    return res.json({ return_code: 'SERVER_ERROR', message: 'Update orders failed — nothing was written. Safe to try again.' });
  }
});

module.exports = router;
