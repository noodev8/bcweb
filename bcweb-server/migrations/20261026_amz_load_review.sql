-- =====================================================================================================================================
-- AMZ LOADED — a review date for styles NOT on Amazon yet (owner, 2026-10-26).
-- =====================================================================================================================================
-- The AMZ loaded screen (dashboard Daily → /amz-loaded) lists every style in stock locally with NO size on Amazon (no amzfeed row —
-- no SKU / FNSKU there), Birkenstock left out. "Give them reviews like prices so can mark if looked at": marking a style stamps this
-- date (today + N days) and hides it from the Due view until then — the same shape as skusummary.next_shopify_price_review.
-- One column on skusummary, no new table (owner prefers reusing what exists; nothing existing could carry it). NULL = never looked at.
-- =====================================================================================================================================

ALTER TABLE skusummary ADD COLUMN IF NOT EXISTS next_amz_load_review date;
