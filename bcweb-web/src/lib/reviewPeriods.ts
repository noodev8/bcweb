/*
=======================================================================================================================================
THE pricing review periods — the "Review in (None) 3 5 7 10 days" choices on every Shopify and Amazon PRICING screen
=======================================================================================================================================
One list for both channels (owner, 2026-11-04: "keep it standard"), read by components/PriceSetter (Shopify style drill),
components/AmzPriceSetter (Amazon size drill), components/BulkActionBar via the Shopify / Amazon lists and Amazon Find,
components/PriceEditor (Add / Modify) and the hidden components/MatchAmazonPanel.

HISTORY: was 3 · 5 · 7 · 10 · 14 · 30 · 90 (each screen kept its own copy). 14, 30 and 90 were taken out 2026-11-04 (owner: "shorten
the pricing list so not to overwhelm" — Amazon moves within days, and the /amz-pricing standard is set to take over the Amazon Due list;
the skill parks 7 days after a price, 3 after a leave). Existing longer review dates were left as they were. The owner may bring any
period back ("bear in mind we might bring them or anything back") — add it here and every pricing screen gets it. The server accepts
any whole number of days ≥ 1, so no route changes.

NOT here on purpose (they are not pricing): AMZ loaded's review (components/ReviewPicker) and New Additions' "Look again in" buttons
keep their own lists. Fixed periods stay fixed: Shopify vs Amazon 10 days, Fast sellers 7.
=======================================================================================================================================
*/

export const REVIEW_PERIODS: number[] = [3, 5, 7, 10];
