-- =====================================================================================================================================
-- 20260910 — google_product_daily / google_campaign_daily: one campaign name, one case
-- =====================================================================================================================================
-- THE BUG
-- `campaign` is part of the PRIMARY KEY of both daily tables, and nothing normalised its case. The legacy Python backfill stored
-- 'STANDARD'; the app's own importer stored whatever Google's export said, which is 'standard'. Postgres keys are case-sensitive, so
-- the upsert never collided — it inserted a SECOND row for the same day/style/campaign/label and left both in place.
--
-- Every figure summed over those days therefore DOUBLED. On 2026-09-10 the Google Ads screen showed £6,234 spend and 14,690 clicks
-- for 11 Aug – 9 Sep; Google's own UI and the source export both said £3,117 and 7,346. Exactly 2x, because every row of that window
-- existed twice.
--
-- Extent when this was written: 5,687 lowercase 'standard' rows (11 Aug – 8 Sep 2026) and 2 'new' rows in google_product_daily,
-- 28 + 1 in google_campaign_daily. Everything older was already upper-case and is untouched.
--
-- THE FIX HAS TWO HALVES. This file is the data half; the code half is utils/googleAdsReports.js, which now upper-cases the campaign
-- name at the parse boundary exactly as it already did for the style id and the label. WITHOUT THE CODE CHANGE THIS MIGRATION BUYS
-- ONE CLEAN DAY — the next import re-creates the lowercase twins.
--
-- WHICH COPY WINS ON A COLLISION: the lowercase one. It came from the most recent import, and Google revises conversions upward for
-- weeks, so the later figure is the better one — the same rule the importer's ON CONFLICT DO UPDATE already applies. An upper-case
-- row with no lowercase twin is a day or style the newest report did not mention; it is KEPT, never deleted, because Google omits
-- zero-impression rows and absence has never meant zero here.
--
-- Safe to re-run: after it has run there is nothing left that differs from its own UPPER().
-- =====================================================================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. google_product_daily
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Drop the upper-case row wherever a not-yet-upper-cased twin exists for the same key. google_label is compared with COALESCE
-- because it is nullable in this table's older rows and NULLs never compare equal — without it the twins would not be recognised as
-- twins and step 2 would fail on the primary key instead.
DELETE FROM google_product_daily u
 USING google_product_daily l
 WHERE l.campaign <> UPPER(l.campaign)
   AND u.campaign =  UPPER(l.campaign)
   AND u.snapshot_date = l.snapshot_date
   AND u.groupid       = l.groupid
   AND COALESCE(u.google_label,'') = COALESCE(l.google_label,'');

-- The survivors can now take the canonical spelling without colliding.
UPDATE google_product_daily
   SET campaign = UPPER(campaign)
 WHERE campaign <> UPPER(campaign);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. google_campaign_daily  (same shape, simpler key)
-- ---------------------------------------------------------------------------------------------------------------------------------
DELETE FROM google_campaign_daily u
 USING google_campaign_daily l
 WHERE l.campaign <> UPPER(l.campaign)
   AND u.campaign =  UPPER(l.campaign)
   AND u.snapshot_date = l.snapshot_date;

UPDATE google_campaign_daily
   SET campaign = UPPER(campaign)
 WHERE campaign <> UPPER(campaign);

COMMIT;
