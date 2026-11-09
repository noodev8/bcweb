-- =====================================================================================================================================
-- AMAZON SP-API SYNC STATE (2026-11-09). One row per job that reads Amazon through the API:
--   'stock'             the quick FBA stock step inside Update Orders (utils/amzStockSync.js) — cursor_at = the moment the last
--                       successful read STARTED; the next run asks Amazon for SKUs changed since then (less an hour's overlap).
--   'inventory_report'  the nightly FBA Inventory report (scripts/amz-inventory-nightly.js) — prices, Seller Central price changes,
--                       new SKUs, zeros, full stock check. It replaced the inventory file on Update Amazon (owner, 2026-11-09).
-- last_error stays set until the next success clears it, so "is it working?" is one row to read.
-- =====================================================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS amz_api_sync (
  job            text PRIMARY KEY,
  cursor_at      timestamptz,
  last_ok_at     timestamptz,
  last_ok_note   text,
  last_error     text,
  last_error_at  timestamptz
);

COMMIT;
