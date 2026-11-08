/*
=======================================================================================================================================
Route: GET /backup-last   (READ ONLY)
=======================================================================================================================================
Purpose: Has the nightly database backup worked? Read by the dashboard's backup warning, which shows ONLY when something is wrong.

WHY (owner, 2026-11-08): the backup (scripts repo db-maint/pg_backup.sh, cron 1am) exits non-zero on any failure, but the crontab has
no MAILTO, so nobody ever saw it — the same silence that hid 109 days of backups not reaching Google Drive in 2026. The script now
ends every run with ONE bclog row (section 'Backup', workstation 'Scheduler'), "OK: …" or "FAILED: …". This reads those rows.

stale = the dashboard should warn:
  - the LATEST run failed (we know it failed — say so the next morning, don't wait), or
  - no OK run in the last 2 days (the script didn't run, or died before it could report), or
  - no Backup row at all (nothing has ever reported — e.g. the script's cron line is missing).
=======================================================================================================================================
Response:
{ "return_code": "SUCCESS",
  "lastOk":     "08 Nov 2026, 01:00" | null,   // London time of the last OK run
  "daysSince":  0 | null,                       // whole days since lastOk
  "lastFailed": { "at": "09 Nov 2026, 01:00", "log": "FAILED: 1 error(s) - upload failed …" } | null,   // only if it is the LATEST run
  "stale":      false }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

const STALE_DAYS = 2;   // no good backup for this long = warn (owner, 2026-11-08)

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const r = await db.query(`
      WITH latest AS (
        SELECT log, created_at FROM bclog WHERE section = 'Backup' ORDER BY created_at DESC LIMIT 1
      ), ok AS (
        SELECT created_at FROM bclog WHERE section = 'Backup' AND log LIKE 'OK%' ORDER BY created_at DESC LIMIT 1
      )
      SELECT
        (SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY, HH24:MI') FROM ok)          AS last_ok,
        (SELECT EXTRACT(EPOCH FROM now() - created_at) / 86400 FROM ok)                                     AS ok_age_days,
        (SELECT log FROM latest)                                                                           AS latest_log,
        (SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY, HH24:MI') FROM latest)      AS latest_at
    `);
    const row = r.rows[0];
    const okAge = row.ok_age_days === null ? null : Number(row.ok_age_days);
    const latestFailed = row.latest_log !== null && !row.latest_log.startsWith('OK');
    const stale = latestFailed || okAge === null || okAge > STALE_DAYS;
    return res.json({
      return_code: 'SUCCESS',
      lastOk: row.last_ok,
      daysSince: okAge === null ? null : Math.max(0, Math.floor(okAge)),
      lastFailed: latestFailed ? { at: row.latest_at, log: row.latest_log } : null,
      stale,
    });
  } catch (err) {
    logger.error('[backup-last] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the last backup' });
  }
});

module.exports = router;
