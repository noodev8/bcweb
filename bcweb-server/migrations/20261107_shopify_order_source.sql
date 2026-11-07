-- =====================================================================================================================================
-- SHOPIFY ORDER SOURCE — where each Shopify order's buyer came from (owner, 2026-11-07).
-- =====================================================================================================================================
-- The goal (docs/seo/PLAN.md): "more Shopify sales we didn't pay Google for", target 20 → 30 sessions a day. Measured with OUR OWN
-- data first, Google's second (owner). Shopify knows, per order, how the buyer arrived — but only Shopify holds it, and its own
-- Analytics label every Google arrival "SEO", paid ads included. This table keeps it in bcweb, for good, with our own reading.
--
-- One row per Shopify order (every source_name: web, POS, draft — came_from says which are not online). Raw facts kept as Shopify gave
-- them so the rule can be re-run if it changes:
--   landing_site / referring_site  REST order fields — the FULL first landing URL, markers included (gclid / gad_source = a paid Google
--                                  ad click, srsltid = Google's free listings / product results). Missing when the shopper declined
--                                  tracking (~half the web orders, 2026-09/11).
--   journey_*                      GraphQL customerJourneySummary.lastVisit — Shopify's own label (it strips the markers, so its
--                                  "Google / SEO" can't tell paid from free); fills some gaps where landing_site is missing.
-- and the reading, from utils/orderSource.js → cameFrom (THE rule):
--   came_from     'Google paid' | 'Google free' | 'Google (paid or free?)' | 'AI' | 'Email' | 'Other search' | 'Social' | 'Other site'
--                 | 'Direct' | 'Unknown' | 'Not online'
--   landing_type  product | collection | home | blog | page | other  (from landing_site, else the journey's landing page)
--   landing_handle  the product / collection handle landed on, when there is one
--
-- Written by Update Orders (utils/orderSync.js, after the orders commit — every run re-reads the last 3 days so a journey that arrives
-- late is picked up) and by scripts/shopify-order-source-backfill.js (history). Upsert by order id; nothing else writes it.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS shopify_order_source (
  shopify_order_id    bigint      PRIMARY KEY,
  ordernum            text        NOT NULL,          -- 'BC19404' (Shopify's order name — the ordernum orderstatus / sales use)
  created_at          timestamptz NOT NULL,
  source_name         text,                          -- 'web', 'shopify_draft_order', POS ids …
  total               numeric(10,2),
  landing_site        text,
  referring_site      text,
  journey_source      text,
  journey_source_type text,
  journey_landing     text,
  came_from           text        NOT NULL,
  landing_type        text,
  landing_handle      text,
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_order_source_created ON shopify_order_source (created_at);
CREATE INDEX IF NOT EXISTS shopify_order_source_came_from ON shopify_order_source (came_from, created_at);
