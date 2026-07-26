/*
=======================================================================================================================================
Script: backfill-price-log-attribution.js   (ONE-OFF maintenance — Analytics "Price Changes" data repair, 2026-07-26)
=======================================================================================================================================
Purpose: Clean up the data defects that made the Price Changes report's BY USER panel untrustworthy. Run in two passes on 2026-07-26;
         both are recorded here because the script is idempotent and the second pass supersedes part of the first.

  FIX 1 — bogus changed_at on legacy Shopify rows.
          When `changed_at timestamptz` was added to price_change_log, every pre-existing row was stamped with the MIGRATION INSTANT
          (2026-07-10 16:31:12.144) instead of its real change date. ~1,677 rows whose real `change_date` spans 2025-04-30 -> 2026-07-09
          therefore look like they all happened on 10 July. The report windows on COALESCE(changed_at, change_date), so a YEAR of history
          was being counted inside "last 30 days" (Andreas read 885 when the true figure was 103; Summer 433 vs 56).
          Repair: NULL the column on exactly those rows so COALESCE falls back to the real `change_date`. We do NOT invent a time of day —
          NULL is the honest value for "instant unknown", and every consumer already handles the fallback.
          Targeted by the exact one-second window of the migration instant, so genuine post-migration rows are untouched.

  FIX 2 — unattributed rows -> attributed to Andreas.
          (a) 454 amz_price_log rows (2 Apr -> 9 Jul 2026) predate the Amazon Pricing v2 module, which is what started resolving
              changed_by server-side; they were logged before attribution existed.
          (b) 1 price_change_log row (id 561, change_date 2025-07-10, "All gone..") carries changed_by = '' from the same era.
          Pass 1 gave both the neutral system label 'Pre-module (auto)'. Pass 2 (owner's call on seeing it) folds them into 'Andreas':
          they were the owner's own pre-module price moves, so a bot-styled label was both wrong and an extra card cluttering BY USER.
          RELABELLED, NOT DELETED — the notes on these rows are real pricing reasoning ("Harvest creep +GBP1.50 — scarce-but-selling:
          4 live, 3u/7d at 49.99, RRP 59.99 headroom") and are worth keeping as history. The set is CLOSED: nothing writes these rows
          any more, so unlike 'Amazon match (auto)' (still written by C:\scripts\amz-match\amz_match_sync.py) this fix stays fixed.
          The WHERE clause therefore matches NULL/blank *and* the interim label, so a re-run from any state lands in the same place.

  NOT touched: 485 price_change_log rows with channel IS NULL (the oldest 2025 Shopify history). The report filters on channel='SHP',
  so they never surface; leaving them alone avoids back-dating a channel we cannot verify. Also not touched: the live system labels
  'Amazon match (auto)' (auto-match cron) and 'Powerbuilder' (legacy app) — those are ongoing writers, so hiding them is a display
  decision, not a data one. Deleting their Shopify rows would also risk the Google sweep, which queues on google_pushed_at IS NULL.

Usage (from bcweb-server/):
  node scripts/backfill-price-log-attribution.js            # DRY RUN — reports counts, rolls back
  node scripts/backfill-price-log-attribution.js --apply    # commits

Idempotent: re-running after a successful apply matches 0 rows on every statement.
=======================================================================================================================================
*/

// Load .env by absolute path (not cwd-relative) so the script runs from anywhere — same pattern as google-price-sweep.js.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { withTransaction } = require('../utils/transaction');
const { pool } = require('../database');

// The migration instant every legacy price_change_log row was stamped with. Matched as a one-second range because the stored value
// carries sub-millisecond precision that an equality literal will not reproduce reliably.
const MIGRATION_FROM = '2026-07-10 16:31:12';
const MIGRATION_TO = '2026-07-10 16:31:13';

// Who the pre-module rows really belong to, and the interim label pass 1 gave them (matched so a re-run is state-independent).
const OWNER = 'Andreas';
const INTERIM_LABEL = 'Pre-module (auto)';

const apply = process.argv.includes('--apply');

(async () => {
  try {
    await withTransaction(async (client) => {
      // FIX 1 — drop the fake instant so the real change_date governs every window.
      const fix1 = await client.query(
        `UPDATE price_change_log
            SET changed_at = NULL
          WHERE changed_at >= $1::timestamptz
            AND changed_at <  $2::timestamptz`,
        [MIGRATION_FROM, MIGRATION_TO]
      );

      // FIX 2a — the pre-module Amazon log rows.
      const fix2a = await client.query(
        `UPDATE amz_price_log
            SET changed_by = $1
          WHERE changed_by IS NULL OR changed_by = '' OR changed_by = $2`,
        [OWNER, INTERIM_LABEL]
      );

      // FIX 2b — the single blank-attribution Shopify row (channel='SHP' only; the channel-NULL legacy block stays untouched).
      const fix2b = await client.query(
        `UPDATE price_change_log
            SET changed_by = $1
          WHERE channel = 'SHP'
            AND (changed_by IS NULL OR changed_by = '' OR changed_by = $2)`,
        [OWNER, INTERIM_LABEL]
      );

      console.log(`FIX 1  price_change_log.changed_at -> NULL      : ${fix1.rowCount} rows`);
      console.log(`FIX 2a amz_price_log.changed_by    -> ${OWNER}  : ${fix2a.rowCount} rows`);
      console.log(`FIX 2b price_change_log.changed_by -> ${OWNER}  : ${fix2b.rowCount} rows`);

      // Post-state readback inside the same transaction, so a dry run shows exactly what the commit would produce. Mirrors the
      // report's own UNION (both logs, 30-day window) rather than one table — a single-log count can never match a BY USER card.
      const check = await client.query(
        `SELECT changed_by,
                COUNT(*) FILTER (WHERE src = 'SHP')::int AS shp,
                COUNT(*) FILTER (WHERE src = 'AMZ')::int AS amz,
                COUNT(*)::int AS total
           FROM (
             SELECT 'SHP' AS src, changed_by FROM price_change_log
              WHERE channel = 'SHP'
                AND COALESCE(changed_at, change_date::timestamptz) >= (CURRENT_DATE - 30)::timestamptz
             UNION ALL
             SELECT 'AMZ', changed_by FROM amz_price_log
              WHERE COALESCE(changed_at, log_date::timestamptz) >= (CURRENT_DATE - 30)::timestamptz
           ) u
          GROUP BY 1
          ORDER BY 4 DESC`
      );
      console.log('\nBY USER as the screen will read it (last 30d — SHP / AMZ / total):');
      check.rows.forEach((r) =>
        console.log(`  ${String(r.changed_by).padEnd(22)} ${String(r.shp).padStart(4)} / ${String(r.amz).padStart(4)} / ${r.total}`)
      );

      if (!apply) {
        console.log('\nDRY RUN — rolling back. Re-run with --apply to commit.');
        throw new Error('__DRY_RUN__');
      }
      console.log('\nCommitting.');
    });
    console.log('Done — committed.');
  } catch (err) {
    if (err.message === '__DRY_RUN__') {
      console.log('Rolled back (dry run).');
    } else {
      console.error('FAILED:', err.stack || err);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
})();
