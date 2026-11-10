-- =====================================================================================================================================
-- SHOPIFY STOCK — last confirmed count per size (2026-11-10). utils/shopifyStockSync.js checks only the sizes whose BCWEB figure has
-- changed since Shopify was last confirmed to show it, instead of reading every live size from Shopify on every Update Orders run.
-- One row per live size: `want` is the count Shopify was last confirmed to show (sent and accepted, or already equal). A size with no
-- row, or whose figure now differs from `want`, is checked. Rows for sizes no longer live are removed by the sync itself.
-- Safe to re-run: IF NOT EXISTS.
-- =====================================================================================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS shopify_stock_sent (
  code         text PRIMARY KEY,
  want         integer NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
