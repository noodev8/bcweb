/*
=======================================================================================================================================
Script: scripts/stock-daily.js   (the nightly stock reading -> stock_daily)
=======================================================================================================================================
Purpose: Write down how many units we own, and their value at cost, at the end of the day just gone — one row in stock_daily, dated
         CURRENT_DATE - 1. Feeds Reports -> Stock vs Sales (the stock line; the sales bars are read live from `sales`).

         Stock is a "right now" fact: nothing can rebuild what we held on a past night, so a night this doesn't run is a day missing
         from the line for good. That is why it runs from cron rather than a button.

         The figure is utils/financeStock.js — the SAME function Month End uses — so the line and the accounts always agree:
           local  = localstock #FREE, deleted = 0     amazon = amzfeed.amztotal     value = units x skusummary.cost

         Replaced C:\scripts\google-ads\update_google_stock_track.py (and its google_stock_track table) on 2026-10-09.

Dates: stamped in SQL (CURRENT_DATE - 1, the pg session runs UTC). Cron fires at 01:45 on a GMT box, which is after midnight UK time
       in both GMT and BST, so the UTC date and the UK date agree and "yesterday" is the UK day that just ended.

Idempotent: ON CONFLICT DO NOTHING — the first reading for a day wins. Running it by hand during the day therefore can't overwrite the
       nightly row with a reading of TODAY's stock wearing yesterday's date. (If it had no row yet, a daytime run WOULD write one that
       is a few hours late — fine as a one-off catch-up, but don't make a habit of it.)

Logging: no crontab entry redirects output, so this writes its own `bclog` row (section 'Stock Daily', who 'Scheduler') on success AND
       on failure — readable on Reports -> Bclog. Exits 0 on success, 1 on a fatal error.

Usage:
    node scripts/stock-daily.js
=======================================================================================================================================
*/

// Load .env by absolute path (relative to this file), so the script runs from any cwd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../database');
const { stockValue } = require('../utils/financeStock');
const { logActivity } = require('../utils/bclog');

const WHO = 'Scheduler';
const SECTION = 'Stock Daily';

async function main() {
  const s = await stockValue();

  const res = await query(
    `INSERT INTO stock_daily (snapshot_date, units, value, local_units, amz_units)
     VALUES (CURRENT_DATE - 1, $1, $2, $3, $4)
     ON CONFLICT (snapshot_date) DO NOTHING
     RETURNING to_char(snapshot_date, 'YYYY-MM-DD') AS d`,
    [s.units, s.value, s.local_units, s.amz_units]
  );

  const msg = res.rowCount
    ? `${res.rows[0].d}: ${s.units} units (local ${s.local_units}, Amazon ${s.amz_units}), £${s.value.toFixed(2)} at cost`
    : `yesterday already recorded — nothing written (now ${s.units} units)`;
  console.log(`[stock-daily] ${msg}`);
  await logActivity({ who: WHO, section: SECTION, log: msg });
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[stock-daily] fatal:', err.message);
    await logActivity({ who: WHO, section: SECTION, log: `FAILED: ${err.message}` });
    process.exit(1);
  });
