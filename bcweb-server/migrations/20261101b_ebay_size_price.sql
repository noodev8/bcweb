-- =====================================================================================================================================
-- EBAY — a price for ONE SIZE inside a listing (owner, 2026-11-01).
-- =====================================================================================================================================
-- Why: a dud size can be cleared on eBay without cutting the style — eBay prices each variation of a listing separately, where Shopify
-- prices per style (memory: check-price-grain). Set BY HAND on the eBay listings screen (POST /ebay-size-price → routes/ebay-size-price.js),
-- sent to eBay at once, and recorded here so BCWEB knows which sizes carry their own price. NULL = the listing's own price
-- (ebay_listing.price). The stock sync sends quantities only, so it never touches a size's price.
-- =====================================================================================================================================

ALTER TABLE ebay_listing_size ADD COLUMN IF NOT EXISTS price        numeric(10,2);
ALTER TABLE ebay_listing_size ADD COLUMN IF NOT EXISTS price_set_at timestamptz;
ALTER TABLE ebay_listing_size ADD COLUMN IF NOT EXISTS price_set_by text;
