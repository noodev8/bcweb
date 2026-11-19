/*
=======================================================================================================================================
Util: utils/vat.js   — THE copy of "which VAT does this size carry" (owner, 2026-11-19)
=======================================================================================================================================
THE RULE: a size's VAT is skumap.tax when it is set, otherwise its style's skusummary.tax.  1 = standard rated, 0 = zero rated.
          skumap.tax is BLANK (NULL) on every size except a deliberate exception — it is NOT a copy of the style flag.

THE STANDARD (owner, 2026-11-19): EVERY style is VAT on (skusummary.tax = 1 — set at creation; Add / Modify has no VAT box any more,
          routes/product-price.js no longer writes it). A zero-rated size is skumap.tax = 0, set by hand from the supplier's invoice —
          a whole children's style too (B710AP: style 1, all 11 sizes 0). So a forgotten exception OVERPAYS VAT, never under-declares.
          Never set a style to 0 to make its sizes zero rated.

WHY: children's footwear is zero rated, and a few styles run from children's into adult sizes (S0324LU, Bloch: sizes 5 and 5.5 are
     zero rated on the supplier's invoice, 6 and 7 standard). The style flag alone made those sizes look ~£7 a pair worse than they
     are and over-declared their VAT. Rare (3 styles when this was written: B710AP, S0324LU, SF3710L), so there is NO screen for it:
     an exception is set by hand in the DB when a senior spots it on an invoice, e.g.
         UPDATE skumap SET tax = 0 WHERE code IN ('S0324LU-05', 'S0324LU-5.5');
     Product copy carries a size's exception to the new colour (same sizes, same VAT).

HISTORY: skumap.tax was a PowerBuilder-era copy of the style flag (1,070 sizes, every one equal to its style). Cleared to NULL on
         2026-11-19 so it means "exception" only — a stale copy would otherwise override a later change to the style flag.
         BCWEB never wrote it before this. Never fill it with copies of the style flag again.

WHERE IT IS READ (every reader of the VAT flag goes through here — keep it that way):
  Month end    utils/financeAmazon.js, utils/financeShopify.js, utils/financeEbay.js        declared VAT per size
  Shop till    routes/shop-sale-record.js                                                  collectedvat / profit
  Amazon       utils/amzProfit.js callers: amazon-order-list, amz-all-list, amzBuyBox(Deck/Team), amzPricingStandard,
               amzImport (+ amzOrderSync via its reference), scripts/amz-price-set.js, scripts/amz-buybox-probe.js
  Shopify      utils/shopifyProfit.js callers: shopifyOrderSync (size), adFloor + shopifyCards (STYLE grain → style flag)
  eBay         utils/ebayProfit.js callers: ebayOrderSync, ebay-listings, ebayCandidates (size), ebay-profit-preview (style)
  A STYLE-grain screen (a Shopify price card, a Google Ads floor) can only use the style flag: Shopify prices per style.

NOT covered, knowingly: the flat "revenue / 1.2" net-revenue margins (analytics, brands, Amazon price dial) — an estimate over all
sales; and utils/revenueFigures.js recovering a DELETED style's cost from its stored Shopify profit assumes standard VAT.
=======================================================================================================================================
*/

/** SQL: the size's VAT flag, from a skumap alias and a skusummary alias. Aliases are written by the caller, never request data. */
function sizeTaxSql(sizeAlias = 'm', styleAlias = 'ss') {
  return `COALESCE(${sizeAlias}.tax, ${styleAlias}.tax)`;
}

/** JS: the same rule when the two flags were read separately. */
function sizeTax(sizeFlag, styleFlag) {
  if (sizeFlag !== null && sizeFlag !== undefined) return Number(sizeFlag);
  if (styleFlag !== null && styleFlag !== undefined) return Number(styleFlag);
  return null;
}

/** True only for an explicit 0. Unknown (null/undefined) is NOT zero rated — the profit utils stay on standard VAT when unsure. */
function isZeroRated(flag) {
  return flag !== null && flag !== undefined && Number(flag) === 0;
}

module.exports = { sizeTaxSql, sizeTax, isZeroRated };
