-- =====================================================================================================================================
-- AMAZON SIZE HISTORY — rows REBUILT from the Inventory Ledger, in the same table (owner, 2026-11-03: "same table for sure").
-- =====================================================================================================================================
-- The ledger (Seller Central → Inventory Ledger, detailed view, manual download) lists every FBA stock movement for 18 months. Walked
-- back from today's stock, it gives each size's physical FBA stock for every past day — scripts/amz-ledger-backfill.js.
--   - source: 'import' = recorded by Update Amazon (utils/amzSizeHistory.js); 'ledger' = rebuilt by the backfill script.
--   - A ledger row holds TOTAL only (what Amazon physically held). live / inbound / price are NULL: the ledger doesn't say how much
--     was sellable, what was on its way in, or the price. Past prices come from sales.soldprice and amz_price_log.
--   - Ledger rows are only ever written for days BEFORE the first import row, so a rebuilt figure never sits beside a recorded one.
-- =====================================================================================================================================

ALTER TABLE amz_size_history ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'import';
ALTER TABLE amz_size_history ALTER COLUMN live DROP NOT NULL;
ALTER TABLE amz_size_history ALTER COLUMN inbound DROP NOT NULL;
