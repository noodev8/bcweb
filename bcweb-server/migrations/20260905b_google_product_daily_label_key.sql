-- =====================================================================================================================================
-- Migration: google_product_daily_label_key   (fixes the primary key created by 20260905_google_ads_module.sql)
-- =====================================================================================================================================
-- WHAT WAS WRONG
-- 20260905_google_ads_module.sql keyed google_product_daily on (snapshot_date, groupid, campaign) and its comment argued that
-- google_label must NOT be in the key, on the reasoning that "a style serves in one campaign per day". That reasoning was wrong, and
-- the first real 13-month import proved it within seconds:
--
--     ERROR: ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- WHY. Google keeps TRUE PER-DAY custom-label history, and on the day a style's label changes it reports that day's activity SPLIT
-- ACROSS BOTH labels — two rows, same day, same style, same campaign, each with its own share of the impressions and spend:
--
--     2025-08-21  0034793-MILANO  label NULL   impr 167  clicks 5  cost 1.11
--     2025-08-21  0034793-MILANO  label 'C00'  impr   5  clicks 0  cost 0.00
--
-- In the 2025-08-01 -> 2026-09-05 export that is 2,371 colliding keys across 4,743 rows. With the label included in the key there are
-- ZERO duplicates. The label is part of the grain; the old key was not merely inconvenient, it was a level too coarse. Had the insert
-- not errored it would have silently kept whichever half landed last and thrown the other away.
--
-- WHY google_label BECOMES NOT NULL DEFAULT ''
-- A NULL in a primary key is not allowed, and even in a unique index NULLs do not compare equal — so "Google reported no label"
-- would never deduplicate against itself and the same row could be inserted endlessly. '' is that state, stored explicitly:
--     ''  = Google reported no custom_label_0 for this style on this day (the report's " --")
-- Nothing else may write '' with a different meaning.
--
-- SAFE ON AN EMPTY OR POPULATED TABLE. Written as an ALTER path rather than a drop/recreate so it behaves the same either way.
-- Apply in pgAdmin against brookfield_prod, after 20260905_google_ads_module.sql.
-- =====================================================================================================================================

-- 1. '' becomes the stored form of "no label". No-op on an empty table; correct on a populated one.
ALTER TABLE google_product_daily ALTER COLUMN google_label SET DEFAULT '';
UPDATE google_product_daily SET google_label = '' WHERE google_label IS NULL;
ALTER TABLE google_product_daily ALTER COLUMN google_label SET NOT NULL;

-- 2. Re-key on the true grain. Dropping the old constraint also drops its index; the new one builds its own.
ALTER TABLE google_product_daily DROP CONSTRAINT IF EXISTS google_product_daily_pkey;
ALTER TABLE google_product_daily
  ADD CONSTRAINT google_product_daily_pkey PRIMARY KEY (snapshot_date, groupid, campaign, google_label);

-- 3. Restate the column comment so the '' convention is discoverable from the database alone.
COMMENT ON COLUMN google_product_daily.google_label IS
  'custom_label_0 AS GOOGLE REPORTED IT on that day, NOT our skusummary.googlecampaign. Part of the PRIMARY KEY: on the day a label '
  'changes, Google splits the day''s activity across both labels and reports two rows. '''' (empty string, never NULL) means Google '
  'reported no label — the export''s " --". The gap between this and googlecampaign is how a feed that has stopped landing becomes '
  'visible on screen.';
