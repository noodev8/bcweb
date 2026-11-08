-- =====================================================================================================================================
-- PRICE_TRACK — DROPPED (owner, 2026-11-08: "drop the table too as we already have the data").
-- =====================================================================================================================================
-- price_track was written nightly by the scripts repo's shopify-sync/price_track.py (retired the same day, now in its archive/): one
-- row per style per day — local + FBA + UK-distributor stock, Shopify price, max Amazon price, and Shopify / Amazon units and average
-- sold price for the last 7 days. 154,151 rows, 2025-06-06 → 2026-11-08, 23 MB, never pruned.
--
-- Why it can go: nothing read it — no BCWEB route or screen (product-delete only named it in a comment), no script (the Amazon
-- pricing notes said "never use for Amazon analysis"). What it held is recorded better elsewhere: stock_daily (units owned per day),
-- amz_size_history (every Amazon size's price + stock over time), price_change_log (every Shopify price change) and sales.
-- No views, foreign keys, triggers or functions referenced it (checked before the drop). Safe to run with any server version.
-- The nightly database backup (db-maint/pg_backup.sh, Drive 10 days) holds the last copy if it is ever wanted.
-- =====================================================================================================================================

DROP TABLE IF EXISTS price_track;
