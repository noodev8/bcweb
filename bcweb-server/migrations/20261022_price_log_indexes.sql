-- =====================================================================================================================================
-- PRICE LOG INDEXES (2026-10-22). Neither price log had an index on the column every per-product lookup filters by, so "the last change
-- for this size / style" read the whole table each time. Harmless at ~2-3k rows, but the logs only grow (one year kept — clean_sales.sql
-- in the scripts repo) and the planned sell-speed figures (priced -> sold, per Amazon size) add more of these lookups.
--
--   amz_price_log (code, id DESC)            — per-SKU reads: the latest row for a code (amzImport, sliders, amz-history), and the
--                                              last real change on or before a sale. id follows insert order, so DESC is "newest first".
--   price_change_log (groupid, change_date DESC, id DESC) — pricing-history's exact WHERE groupid = $1 ... ORDER BY change_date DESC, id DESC.
--
-- CONCURRENTLY so the build never blocks the writes (W1 / W-A1) — which means these lines can't run inside a transaction block: run
-- them one at a time, outside BEGIN. IF NOT EXISTS makes a re-run harmless. To undo: DROP INDEX CONCURRENTLY <name>.
-- =====================================================================================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS amz_price_log_code_idx
  ON amz_price_log (code, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS price_change_log_groupid_idx
  ON price_change_log (groupid, change_date DESC, id DESC);
