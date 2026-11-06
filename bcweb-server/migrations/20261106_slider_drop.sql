-- =====================================================================================================================================
-- PRICING SLIDER — REMOVED (owner, 2026-11-06: "I dont use it, and it will just confuse price changes as well as staff").
-- =====================================================================================================================================
-- Drops the slider's two tables. The code that read and wrote them (the /slider screens, the slider-* routes, utils/slider.js and the
-- "a product in a live slider reads as parked" test on every pricing list and Due count) was removed in the same change.
--
-- What was in them at removal: 2 groups — "Caprice AMZ" (id 57, Amazon, active, 24 sizes all 'sliding' at step 0 — it never moved a
-- price) and "test" (id 58, Shopify, no members). No price_change_log / amz_price_log row ever came from the slider. Its 16 bclog lines
-- (section 'Slider') stay as history. Those 24 Caprice sizes simply become ordinary sizes: no review date, so Due on the Amazon lists.
--
-- RUN ONLY AFTER the server WITHOUT the slider code is deployed: the old server queries slider_member on every pricing list, Repricing
-- count and Daily count, and would throw on all of them without it.
-- =====================================================================================================================================

DROP TABLE IF EXISTS slider_member;
DROP TABLE IF EXISTS slider_group;
