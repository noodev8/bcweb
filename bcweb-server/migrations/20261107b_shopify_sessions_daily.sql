-- =====================================================================================================================================
-- SHOPIFY SESSIONS DAILY — visits to the shop per day, by where they came from (owner, 2026-11-07).
-- =====================================================================================================================================
-- The visits target: Shopify sessions from ~20 a day to 30 (docs/seo/PLAN.md) — in SHOPIFY's count (GA4 counts ~2x, so the target is
-- Shopify's; owner chose Shopify). Read from Shopify's sessions report (ShopifyQL, the read_reports permission on the "bcweb-fulfill"
-- Dev Dashboard app) by utils/shopifySessions.js.
--
-- One row per day per source combination exactly as Shopify groups it (referrer_source / referrer_name / utm_source / utm_medium,
-- '' for none) — raw, so the rule can be re-run — plus came_from, the SAME labels as shopify_order_source (Google paid / Google free /
-- Google (paid or free?) / AI / Email / Other search / Social / Other site / Direct / Unknown), so visits and sales line up by source.
-- Paid vs free Google: only from 2026-11-08, when the Google Ads final URL suffix (utm_medium=cpc) was in place; before that Shopify's
-- "search / google" holds both and is labelled 'Google (paid or free?)'.
--
-- Written by Update Orders (the last 3 days each run — Shopify revises recent days, today is partial) and
-- scripts/shopify-sessions-backfill.js. Each write REPLACES its days. KEEPS 2 YEARS (owner, 2026-11-07), purged by the same step.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS shopify_sessions_daily (
  day              date        NOT NULL,
  referrer_source  text        NOT NULL DEFAULT '',
  referrer_name    text        NOT NULL DEFAULT '',
  utm_source       text        NOT NULL DEFAULT '',
  utm_medium       text        NOT NULL DEFAULT '',
  sessions         integer     NOT NULL,
  came_from        text        NOT NULL,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, referrer_source, referrer_name, utm_source, utm_medium)
);

CREATE INDEX IF NOT EXISTS shopify_sessions_daily_came_from ON shopify_sessions_daily (came_from, day);
