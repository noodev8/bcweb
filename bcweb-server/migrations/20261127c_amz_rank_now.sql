-- =====================================================================================================================================
-- AMAZON RANK FOR EVERY LISTING, TODAY ONLY (owner, 2026-11-27). Rules: utils/amzRank.js (THE copy).
-- =====================================================================================================================================
-- The Fashion Best Sellers Rank of EVERY one of our Amazon listings (amzfeed ASINs), 0-stock ones included — the Buy Box read only
-- covers sizes live / inbound at FBA (amz_buybox_now.sales_rank), so a size we've run out of was never read. Amazon Order uses it to
-- flag a size we have none of, can get, and that ranks well now (owner: "indicate a solid ranking of something we have no stock of,
-- but Rieker have"). Written by the hourly whole-list Buy Box read. TODAY ONLY — no history, no trend (the owner's 2026-11-14 rule).
--   asin        upper-cased, as amzfeed's trimmed + upper-cased
--   sales_rank  Fashion rank; 0 = read fine, Amazon gave none
--   read_at     when
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS amz_rank_now (
  asin        text        PRIMARY KEY,
  sales_rank  integer     NOT NULL,
  read_at     timestamptz NOT NULL DEFAULT now()
);
