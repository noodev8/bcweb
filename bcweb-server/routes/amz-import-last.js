/*
=======================================================================================================================================
API Route: amz_import_last
=======================================================================================================================================
Method: GET
Purpose: Update Amazon module — tell the operator when this was last run. Reads the bclog row written by amz-import-commit (section
         'Amazon Update'), most recent first. bclog.created_at is UTC (timestamptz); formatted server-side to Europe/London so the
         front end never has to think about the BST offset.

         No row found (never run, or bclog predates this feature) -> lastRun: null. The page shows "unknown" rather than guessing.

         Also returns `history` — the SIZE HISTORY status (utils/amzSizeHistory.js → readHistoryStatus): the Update Amazon screen's
         status line, and the dashboard's warning, shown ONLY when `stale` (more than 3 days with no inventory import — owner,
         2026-11-03: "ensure it doesn't get too big and forgotten"). null if the table isn't there yet (migration not applied).

         And `amazonApi` (2026-11-09) — the SP-API stock reads from amz_api_sync: `stock` = the quick read inside Update Orders,
         `report` = the nightly FBA Inventory report (which replaced the inventory upload). Each { lastOk, note, error, errorAt } or
         null; the whole field null if the table isn't there yet. An error stays until the next success clears it.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "lastRun": "28 Jul 2026, 14:32", "by": "Andreas",
  "history": { "lastDay": "03 Nov 2026", "firstDay": "03 Nov 2026", "days": 1, "daysSince": 0, "rows": 658, "bytes": 106496,
               "stale": false, "staleAfterDays": 3 } }
{ "return_code": "SUCCESS", "lastRun": null, "by": null, "history": null }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { readHistoryStatus } = require('../utils/amzSizeHistory');
const logger = require('../utils/logger');

router.use(verifyToken);

async function readApiStatus() {
  try {
    const r = await db.query(
      `SELECT job, to_char(last_ok_at AT TIME ZONE 'Europe/London', 'DD Mon, HH24:MI') AS last_ok, last_ok_note,
              last_error, to_char(last_error_at AT TIME ZONE 'Europe/London', 'DD Mon, HH24:MI') AS last_error_at, detail,
              EXTRACT(EPOCH FROM (now() - last_ok_at)) / 3600 AS hours_since_ok
       FROM amz_api_sync`
    );
    const pick = (job) => {
      const x = r.rows.find((y) => y.job === job);
      return x ? { lastOk: x.last_ok, note: x.last_ok_note, error: x.last_error, errorAt: x.last_error_at } : null;
    };
    // The nightly report's reconciliation (unknown SKUs + Delete file, …) — the panel the inventory upload used to show.
    const rep = r.rows.find((y) => y.job === 'inventory_report');
    // The dashboard's red warning (owner, 2026-11-09): any Amazon read whose LAST attempt failed, or the nightly job not run for 36h
    // (cron stopped — a failed run would show as an error instead). Fees run every 28 days, so their age never warns, only an error.
    const problems = [];
    const label = { stock: 'stock read', orders: 'order read', inventory_report: 'nightly inventory report', returns_report: 'nightly returns report', fees_report: 'fee report' };
    for (const x of r.rows) if (x.last_error) problems.push(`${label[x.job] || x.job} failed ${x.last_error_at}`);
    if (rep && rep.hours_since_ok !== null && Number(rep.hours_since_ok) > 36 && !rep.last_error) problems.push(`nightly reports not run since ${rep.last_ok}`);
    return {
      stock: pick('stock'),
      orders: pick('orders'),
      report: pick('inventory_report'),
      returns: pick('returns_report'),
      fees: pick('fees_report'),
      reconciliation: (rep && rep.detail && rep.detail.reconciliation) || null,
      problems,
    };
  } catch (err) {
    if (/amz_api_sync/.test(err.message)) return null;   // table not there yet
    throw err;
  }
}

router.get('/', async (req, res) => {
  try {
    const [result, history, amazonApi] = await Promise.all([
      db.query(
        `SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY, HH24:MI') AS last_run, workstation
         FROM bclog WHERE section = 'Amazon Update' ORDER BY created_at DESC LIMIT 1`
      ),
      readHistoryStatus(db),
      readApiStatus(),
    ]);
    const row = result.rows[0];
    return res.json({ return_code: 'SUCCESS', lastRun: row?.last_run || null, by: row?.workstation || null, history, amazonApi });
  } catch (err) {
    logger.error('[amz-import-last] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the last import time' });
  }
});

module.exports = router;
