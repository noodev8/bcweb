/*
=======================================================================================================================================
API Route: google_ads_import_last
=======================================================================================================================================
Method: GET
Purpose: Google Ads module — how fresh is the ad data, and where are the holes. Drives the screen's freshness banner.

         Requires auth. Read-only.

WHY THIS IS MORE THAN "WHEN DID IT LAST RUN"
Imports here are deliberately unscheduled — the owner downloads the reports when they are about to work the screen, which may be
weekly or may be quarterly (docs/google-ads-spec.md §7.8). That makes staleness a normal state rather than a fault, and it makes
the SHAPE of what we hold the thing worth reporting:

  - `lastRun`   when a human last imported anything (bclog).
  - `coverage`  the first and last day we actually hold data for, per report, and how many days that is.
  - `gaps`      days INSIDE that range with nothing at all.

THE GAPS ARE THE POINT. google_campaign_daily lost 12 July - 2 August 2026 — 22 days — because imports were sporadic and a
Last-30-days window on 3 September could not reach back far enough. Nothing announced it. On screen a silent hole reads as a quiet
month, which in August would have read as a seasonal slowdown rather than a missing import.

Holes are recoverable: Google still holds the data, and a custom-range export over the gap dates imports like any other file. So
this route's job is to make them impossible to miss while they still CAN be filled.

A gap is reported, never judged. A genuinely paused account produces real empty days, and this route cannot tell those from a missed
import — the operator can.

DATES ARE CAST TO TEXT IN SQL, never handed back as a pg DATE. A pg DATE arriving in Node becomes local midnight, and toISOString()
then shifts it a day back under BST (CLAUDE.md). Every date below is `to_char(...)`.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "lastRun": "5 Sep 2026, 14:32",
  "by": "Andreas",
  "product": {
    "from": "2026-08-06", "to": "2026-09-04", "days": 30, "rows": 5855,
    "daysOld": 1,                       // today minus `to` — how stale the newest day is
    "gaps": []                          // [{ "from": "2026-07-12", "to": "2026-08-02", "days": 22 }]
  },
  "campaign": { "from": "2026-04-04", "to": "2026-09-04", "days": 154, "rows": 181, "daysOld": 1, "gaps": [] }
}
  - product / campaign are null when that table holds nothing at all.
  - lastRun / by are null when nothing has been imported through bcweb yet (the campaign table predates this module).
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

/**
 * Coverage + gaps for one daily table, in a single query.
 *
 * generate_series over the table's own min..max produces every day that SHOULD be there; the LEFT JOIN finds the ones that are not.
 * Consecutive missing days are then collapsed into ranges client-side of the SQL, because "22 days missing, 12 Jul to 2 Aug" is a
 * fact the operator can act on and twenty-two separate dates is a list they will scroll past.
 *
 * tableName is interpolated, so it is ONLY ever called with the two hard-coded literals below — never anything from a request.
 */
async function coverage(tableName) {
  const res = await query(`
    WITH bounds AS (
      SELECT MIN(snapshot_date) AS lo, MAX(snapshot_date) AS hi, COUNT(*) AS rows
        FROM ${tableName}
    ),
    present AS (
      SELECT DISTINCT snapshot_date FROM ${tableName}
    ),
    all_days AS (
      SELECT generate_series(b.lo, b.hi, interval '1 day')::date AS d FROM bounds b WHERE b.lo IS NOT NULL
    )
    SELECT
      (SELECT to_char(lo,'YYYY-MM-DD') FROM bounds)                       AS "from",
      (SELECT to_char(hi,'YYYY-MM-DD') FROM bounds)                       AS "to",
      (SELECT rows FROM bounds)                                           AS rows,
      (SELECT COUNT(*) FROM present)                                      AS days,
      (SELECT (CURRENT_DATE - hi) FROM bounds)                            AS days_old,
      COALESCE(
        (SELECT array_agg(to_char(a.d,'YYYY-MM-DD') ORDER BY a.d)
           FROM all_days a
          WHERE NOT EXISTS (SELECT 1 FROM present p WHERE p.snapshot_date = a.d)),
        '{}'
      )                                                                   AS missing
  `);

  const row = res.rows[0];
  if (!row || !row.from) return null;

  // Collapse the missing dates into contiguous ranges.
  const ranges = [];
  for (const iso of row.missing || []) {
    const last = ranges[ranges.length - 1];
    if (last) {
      const next = new Date(`${last.to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      if (next.toISOString().slice(0, 10) === iso) { last.to = iso; last.days += 1; continue; }
    }
    ranges.push({ from: iso, to: iso, days: 1 });
  }

  return {
    from: row.from,
    to: row.to,
    rows: Number(row.rows),
    days: Number(row.days),
    daysOld: row.days_old === null ? null : Number(row.days_old),
    gaps: ranges,
  };
}

router.get('/', async (req, res) => {
  try {
    // bclog is the shared activity log; 'Google Ads' is this module's section, written by google-ads-import-commit inside the same
    // transaction as the import itself. Formatted to Europe/London server-side so the front end never handles the BST offset.
    const runRes = await query(`
      SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'FMDD Mon YYYY, HH24:MI') AS last_run,
             workstation AS by
        FROM bclog
       WHERE section = 'Google Ads'
       ORDER BY created_at DESC
       LIMIT 1
    `);

    const [product, campaign] = await Promise.all([
      coverage('google_product_daily'),
      coverage('google_campaign_daily'),
    ]);

    return res.json({
      return_code: 'SUCCESS',
      lastRun: runRes.rows[0] ? runRes.rows[0].last_run : null,
      by: runRes.rows[0] ? runRes.rows[0].by : null,
      product,
      campaign,
    });
  } catch (err) {
    logger.error('[google-ads-import-last] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not read the import history' });
  }
});

module.exports = router;
