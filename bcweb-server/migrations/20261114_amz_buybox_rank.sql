-- =====================================================================================================================================
-- AMAZON BUY BOX — SALES RANK ON THE PRICE CARD (owner, 2026-11-14: "just the rank on the card. Nothing extra. Fashion overall").
-- =====================================================================================================================================
--   sales_rank  amz_buybox_now only: Amazon's Fashion (display group) Best Sellers Rank for the size's ASIN, read with each Buy Box
--               read (Catalog Items, salesRanks). Sizes carry the PARENT's rank (checked on IVES 2026-11-14: every size and colour
--               of the family read #18,707), so it is a family figure. Today only — no history, no trend (owner). 0 = read but Amazon
--               gave no rank (card: "Rank: none"); NULL = the rank call failed / not read (card shows nothing).
-- =====================================================================================================================================

ALTER TABLE amz_buybox_now ADD COLUMN IF NOT EXISTS sales_rank integer;
