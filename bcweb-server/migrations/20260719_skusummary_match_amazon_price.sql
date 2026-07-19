-- =====================================================================================================================
-- Migration: skusummary.match_amazon_price
-- Date: 2026-07-19
-- =====================================================================================================================
-- Purpose: Per-style (groupid) opt-in flag for the Shopify "match Amazon price" feature.
--
--   When TRUE, the style's Shopify price is kept in step with Amazon's cheapest IN-STOCK size:
--       shopifyprice = MIN(amzfeed.amzprice) over that groupid's rows WHERE amzlive > 0
--   set by the self-contained cron job  C:\scripts\amz-match\amz_match_sync.py  (see its README). Amazon is the ceiling
--   ("never higher than Amazon lowest") so Shopify stays competitive while Amazon is never undercut by omission. The job
--   reconciles off amzfeed (Amazon's own nightly truth), so it also catches price changes made outside our tools.
--
--   Default FALSE = every existing style keeps today's behaviour (nothing is auto-matched until explicitly enabled).
--
-- Applied in pgAdmin against brookfield_prod (this file is the record; migrations here are run by hand — CLAUDE.md).
-- =====================================================================================================================

ALTER TABLE skusummary
  ADD COLUMN IF NOT EXISTS match_amazon_price boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN skusummary.match_amazon_price IS
  'Shopify auto-matches Amazon lowest in-stock price for this style (bcweb Shopify Pricing; driver = C:\scripts\amz-match).';
