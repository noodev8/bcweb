-- =====================================================================================================================================
-- NEW ADDITIONS — a review date for NEW styles (owner, 2026-10-27).
-- =====================================================================================================================================
-- Reports → New Additions lists every size of every style created in 90 days (utils/processMap.js). "Add a review and due date to them
-- as well — these are products that need actions and easily inspected": marking a style stamps this date (today + N days) and hides it
-- from the screen's Due view until then — the same shape as skusummary.next_amz_load_review / next_shopify_price_review.
-- NULL = never reviewed: the style falls due on its own FIRST_REVIEW_DAYS (20) after it was created (utils/processMap.js).
-- One column on skusummary, no new table (owner prefers reusing what exists; no existing review date means "new line looked at").
-- =====================================================================================================================================

ALTER TABLE skusummary ADD COLUMN IF NOT EXISTS next_new_review date;
