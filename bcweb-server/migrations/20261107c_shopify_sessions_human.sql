-- =====================================================================================================================================
-- SHOPIFY SESSIONS DAILY — human visits only, and Shopify's own paid / organic label (owner, 2026-11-07, same day as 20261107b).
-- =====================================================================================================================================
-- The first fill counted BOT sessions too and ran about a third high: Shopify's Home showed 6 sessions today while the table had 22
-- (16 of them bots). Home counts HUMAN visits — utils/shopifySessions.js now reads only those (human_or_bot_session = 'human').
--
-- It also now keeps Shopify's traffic_type (paid / organic / direct / unknown) per row, because Shopify sets it from the ad click
-- itself — so past Google visits split into paid and free too, not only from the Google Ads final URL suffix (2026-11-08). It joins the
-- primary key (a day × source combination can now come back once per traffic_type).
--
-- After applying: re-run scripts/shopify-sessions-backfill.js --commit — every month REPLACES its days, so the bot-inclusive rows from
-- the first fill are all overwritten with human-only ones.
-- =====================================================================================================================================

ALTER TABLE shopify_sessions_daily ADD COLUMN IF NOT EXISTS traffic_type text NOT NULL DEFAULT '';

ALTER TABLE shopify_sessions_daily DROP CONSTRAINT IF EXISTS shopify_sessions_daily_pkey;
ALTER TABLE shopify_sessions_daily
  ADD CONSTRAINT shopify_sessions_daily_pkey PRIMARY KEY (day, referrer_source, referrer_name, utm_source, utm_medium, traffic_type);
