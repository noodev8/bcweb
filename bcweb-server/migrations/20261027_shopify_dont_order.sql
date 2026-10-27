-- =====================================================================================================================================
-- SHOPIFY ORDER — "Don't order" a SIZE (owner, 2026-10-27).
-- =====================================================================================================================================
-- Shopify Order's Sellers view lists every non-Birkenstock size that sold on Shopify in 30 days; its Missed preset (and the Daily
-- Ordering tile's count) is the ones with nothing local, on order or at FBA. Some are duds the owner won't re-order: "Don't order"
-- takes that one size out of Missed. Not "Can't get it" (skusummary.no_supply_*): that is a STYLE fact meaning the supplier has none,
-- hides every size from both order screens and lapses after three months — a dud is a choice about one size.
-- LAPSES ON ITS OWN when the size sells again on Shopify (a sale dated AFTER the day it was marked — routes/shopify-sellers-list.js),
-- so a dud that starts selling comes back for another look. A lapsed row is simply ignored, and the next mark overwrites it.
-- One row per size (code = skumap.code). Written by /shopify-dont-order-set and /shopify-dont-order-clear.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS shopify_dont_order (
  code       text PRIMARY KEY,
  marked_at  timestamptz NOT NULL DEFAULT now(),
  marked_by  text
);
