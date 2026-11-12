-- =====================================================================================================================================
-- AMAZON BUY BOX — OUR FEATURED OFFER ELIGIBILITY (owner, 2026-11-12: "yes, save the eligibility flag"). Rules in utils/amzBuyBox.js.
-- =====================================================================================================================================
-- itemOffers' IsFeaturedMerchant says whether Amazon will consider an offer for the Buy Box at all. A size where OUR offer isn't
-- eligible is shown to 0% of views whatever its price, so the screen tags it ("Amazon won't feature us") and no price move is the
-- answer (check the listing / account in Seller Central). Checked on IVES-WHITE 03–09 the day it was added: all eligible.
--
--   our_eligible  amz_buybox_now + amz_buybox_history: our offer's IsFeaturedMerchant; NULL = our offer wasn't in Amazon's list /
--                 not known at that read. In history it is one of the change-only fields, so a size losing eligibility gets a row.
--   offers[].elig every offer's flag, in the existing offers jsonb (no column).
-- =====================================================================================================================================

ALTER TABLE amz_buybox_now     ADD COLUMN IF NOT EXISTS our_eligible boolean;
ALTER TABLE amz_buybox_history ADD COLUMN IF NOT EXISTS our_eligible boolean;
