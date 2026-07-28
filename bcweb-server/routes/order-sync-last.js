/*
=======================================================================================================================================
API Route: order_sync_last
=======================================================================================================================================
Method: GET
Purpose: Tell the Sales screen when orders were last synced, so the button can carry a quiet "· 2h ago" instead of the operator having
         to guess. Reads the bclog row written by /order-sync (section 'Order Sync').

         This only ever sees BCWEB runs. The cron Python (C:\scripts\orders\update_orders.py) writes no bclog row, so "last run" means
         "last time somebody pressed the button", not "last time the pipeline ran". That is the honest reading and the front end labels
         it as such — adding a bclog write to the Python would be the way to make it mean both.

         bclog.created_at is UTC (timestamptz). Both a formatted London stamp and the raw ISO value are returned: the stamp for a
         tooltip, the ISO for the relative "2h ago" the button renders.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "lastRun": "28 Jul 2026, 14:32", "lastRunIso": "2026-07-28T13:32:07.881Z", "by": "Andreas",
  "log": "Order Sync: +3 orders · +3 sales · 3 picks" }
{ "return_code": "SUCCESS", "lastRun": null, "lastRunIso": null, "by": null, "log": null }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY, HH24:MI') AS last_run,
              created_at AS last_run_iso, workstation, log
         FROM bclog WHERE section = 'Order Sync' ORDER BY created_at DESC LIMIT 1`
    );
    const row = result.rows[0];
    return res.json({
      return_code: 'SUCCESS',
      lastRun: row?.last_run || null,
      // timestamptz comes back as a JS Date; toISOString is safe here (it is a real instant, not a pg DATE — see CLAUDE.md's date landmine).
      lastRunIso: row?.last_run_iso ? row.last_run_iso.toISOString() : null,
      by: row?.workstation || null,
      log: row?.log || null
    });
  } catch (err) {
    logger.error('[order-sync-last] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the last sync time' });
  }
});

module.exports = router;
