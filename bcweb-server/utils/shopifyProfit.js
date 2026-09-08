/*
=======================================================================================================================================
Module: utils/shopifyProfit.js
=======================================================================================================================================
Purpose: The per-unit NET profit of a Shopify sale — the number written to `sales.profit` on every SHP row, and therefore the number
         the Analytics Sales screen adds up and the owner prices against. One function, one formula, so nothing can drift.

         This is the Shopify counterpart of utils/amzProfit.js. Until now the formula existed ONLY inside
         C:\scripts\orders\update_orders.py -> shopify_profit(). CLAUDE.md and that script's own docstring both pointed at
         "bcweb-server/utils/profit.js" and "docs/profit-model.md", neither of which had ever been written. This file is that
         reference, finally made real; docs/order-sync-port.md is the reasoning.

         !! DUAL IMPLEMENTATION !! — this formula also lives in C:\scripts\orders\update_orders.py -> shopify_profit().
         Both write `sales.profit` on SHP rows. If they disagree, the Analytics totals become a blend of two formulas with nothing
         recording which row got which. See the full banner at the top of utils/orderSync.js.

THE FORMULA
    VAT      = sold / 6                    UK VAT is 1/6 of a VAT-INCLUSIVE price (20% of the ex-VAT amount)
    Gross    = sold - VAT - cost
    Expenses = payment fee (30p + 2.9%) + packing/wages 1.00 + Royal Mail 3.44
    Profit   = (Gross - Expenses) / 1.2    the /1.2 is a flat "cover refunds" haircut

WHY THE /1.2 IS HERE. It is the same haircut the Amazon side carries (utils/amzProfit.js, RETURNS_DIVISOR), and it is here for the same
reason: sales.profit has to read as *what the owner keeps on a unit sold*, because that is the number he buys and prices on. Removing
it would overstate what a Shopify sale keeps. Do not "simplify" it away without reading the paragraph below first.
(docs/update-amazon-port.md 2.11 is the long version of that argument, measured.)

!! THE PREMISE OF THAT ARGUMENT IS WRONG — MEASURED 2026-09-08 !! This block used to claim that "Shopify returns are not booked as
reversal rows the way Amazon's are, so on this channel the haircut is the ONLY place return cost is modelled at all". THE DATA SAYS
OTHERWISE. Over the 365 days to 2026-09-08 the SHP rows in sales carry 543 reversals (qty = -1), 363 of them with a returnsaleid,
totalling -GBP 5,269 of profit: a 12.7% unit return rate, booked as rows exactly like Amazon's.

WHAT THAT MEANS, STATED CAREFULLY. Return cost is modelled TWICE for any consumer that sums every row — once by the reversal rows
themselves (-GBP 5,269) and again by this haircut, which suppresses roughly GBP 7,826 across the positive rows over the same period.
Whole-book aggregates (Analytics > Sales, Ad Efficiency) therefore read LOW. Consumers that filter qty > 0 — routes/birk-stock.js
(Kept) and the pricing WINNERS / LOSERS bars — see the haircut alone and are internally consistent, which is why this has never
surfaced as an obvious error.

THE FORMULA IS DELIBERATELY NOT CHANGED HERE. It is duplicated in the Python update_orders.py (see the banner above), sales.profit is
STORED rather than computed on read, and every threshold on the platform is calibrated against the number as it stands today: the
pricing WINNERS bar (GBP 2 average net profit), the Birkenstock Kept ladder, and utils/adFloor.js, which inverts this exact formula to
place a price. Correcting the double-count is a real decision with a backfill behind it, not a tidy-up. Whoever takes it on: decide
whether returns live in the ROWS or in the HAIRCUT — not both — and recalibrate the thresholds in the same pass.

The estimates are deliberately conservative — owner's words: "purposely estimated high so that if I can make a profit with these, I am
safe." Packing and Royal Mail are flat estimates left high on purpose. Read the output as a floor, not an accounting figure.
=======================================================================================================================================
*/

// Named so a rate change is a one-line edit with an obvious blast radius, rather than a magic number buried in an expression.
const VAT_DIVISOR = 6;          // VAT-inclusive price / 6 = the VAT in it (20% VAT)
const PAYMENT_FIXED = 0.30;     // Shopify Payments: 30p per transaction
const PAYMENT_RATE = 0.029;     //                 + 2.9% of the sale
const PACKING = 1.00;           // packaging + wages, flat estimate (deliberately high)
const ROYAL_MAIL = 3.44;        // outbound postage, flat estimate (deliberately high)
const RETURNS_DIVISOR = 1.2;    // flat "cover refunds" haircut — see the note above before touching this

/*
 * shopifyProfit(sold, cost) -> number | null
 *   sold: the per-unit sold price (ex nothing — the VAT-inclusive price the customer paid)
 *   cost: the per-unit cost of goods, or null/undefined when unknown
 *
 * Returns per-unit net profit rounded to 2dp, or NULL when either input is unusable. NULL is deliberate and load-bearing: the caller
 * stores NULL rather than a wrong figure, so a missing skusummary.cost shows as "—" on the Sales screen instead of quietly reporting
 * the whole sale price as profit. (skusummary.cost is a legacy VARCHAR that can hold junk — see CLAUDE.md's schema landmines.)
 */
function shopifyProfit(sold, cost) {
  const s = toNumber(sold);
  const c = toNumber(cost);
  if (s === null || c === null) return null;

  const vat = s / VAT_DIVISOR;
  const gross = s - vat - c;
  const paymentFee = PAYMENT_FIXED + PAYMENT_RATE * s;
  const expenses = paymentFee + PACKING + ROYAL_MAIL;

  // Math.round(x * 100) / 100 matches Python's round(x, 2) closely enough for money at this scale; both are stored into a numeric
  // column that would round anyway. Kept explicit so the stored value and a hand-check of the formula agree to the penny.
  return Math.round(((gross - expenses) / RETURNS_DIVISOR) * 100) / 100;
}

/*
 * priceForProfit(targetProfit, cost) -> number | null
 *   The INVERSE of shopifyProfit(): the VAT-inclusive sold price at which a unit nets exactly `targetProfit`.
 *
 * Why it lives here and not in the caller: this is the same formula read backwards, so it MUST share the constants above. Solving it
 * in utils/adFloor.js (its only caller today) would put a second copy of VAT, the payment fee and the returns haircut in the codebase
 * — exactly the drift this module exists to prevent. A rate change stays a one-line edit.
 *
 * The algebra, with the constants named above:
 *     profit = ((sold - sold/6 - cost) - (0.30 + 0.029*sold) - 1.00 - 3.44) / 1.2
 * Collect the terms in `sold`:
 *     profit * 1.2 = sold * (1 - 1/6 - 0.029) - cost - (0.30 + 1.00 + 3.44)
 * and rearrange for sold:
 *     sold = (cost + 4.74 + 1.2 * profit) / 0.804333...
 *
 * Verified against the live DB: priceForProfit(13.05, 37.50) = 71.99, the actual price 1030498-ARIZONA sold at, and shopifyProfit()
 * returns 13.05 for that pair — the round trip closes to the penny.
 *
 * Returns null on unusable input, for the same load-bearing reason shopifyProfit() does: a caller must show "—", never a wrong price.
 */
function priceForProfit(targetProfit, cost) {
  const p = toNumber(targetProfit);
  const c = toNumber(cost);
  if (p === null || c === null) return null;

  // The share of a VAT-inclusive price that survives VAT and the percentage payment fee. Derived from the constants, never typed as
  // a literal, so it cannot drift from shopifyProfit() above.
  const priceCoefficient = 1 - 1 / VAT_DIVISOR - PAYMENT_RATE;
  const flatCosts = PAYMENT_FIXED + PACKING + ROYAL_MAIL;

  const sold = (c + flatCosts + RETURNS_DIVISOR * p) / priceCoefficient;
  if (!Number.isFinite(sold)) return null;
  return Math.round(sold * 100) / 100;
}

/*
 * toNumber(v) -> number | null
 * Defensive parse for the legacy VARCHAR money columns. Anything that isn't a finite number (NULL, '', 'RRP', 'n/a') becomes null so
 * the caller ends up storing NULL rather than NaN. Mirrors the try/except float() the Python does around skusummary.cost.
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

module.exports = { shopifyProfit, priceForProfit, toNumber };
