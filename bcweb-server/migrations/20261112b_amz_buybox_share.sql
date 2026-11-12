-- =====================================================================================================================================
-- AMAZON BUY BOX — SHARE OF VIEWS replaces Amazon's expected price (owner, 2026-11-12: "swap to the share-of-views read. get rid of
-- Amazon expected price"). Rules in utils/amzBuyBox.js; why in docs/amz-buybox/PLAN.md (the IVES-WHITE-06 analysis).
-- =====================================================================================================================================
-- The Buy Box is shared by customer group (Prime / non-Prime / default, by postcode), each with a share of page views
-- (competitiveSummary featuredBuyingOptions). On IVES-WHITE-06 a seller at our exact price was featured to ~89% of views, the £36.39
-- one to ~11%, us to 0%. Amazon's "featured offer expected price" was wrong both times it was checked, so it is no longer read.
--
--   our_share   % of page views where WE are the featured offer — our Buy Box %, per size (kept in history as a whole %)
--   lead_share  the share of the offer featured to the most views (holder / bb_price are that offer's)
--   featured    every featured offer: [{ seller, us, fba, price, share, segments: [{ who, pct }] }]
-- =====================================================================================================================================

ALTER TABLE amz_buybox_now DROP COLUMN IF EXISTS foep;
ALTER TABLE amz_buybox_now DROP COLUMN IF EXISTS foep_status;
ALTER TABLE amz_buybox_now ADD COLUMN IF NOT EXISTS our_share  numeric(5,1);
ALTER TABLE amz_buybox_now ADD COLUMN IF NOT EXISTS lead_share numeric(5,1);
ALTER TABLE amz_buybox_now ADD COLUMN IF NOT EXISTS featured   jsonb;
ALTER TABLE amz_buybox_history ADD COLUMN IF NOT EXISTS our_share smallint;   -- whole %; NULL = not known at that read
