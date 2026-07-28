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

WHY THE /1.2 IS HERE AND STAYS. It is the same haircut the Amazon side carries (utils/amzProfit.js, RETURNS_DIVISOR), and it is here
for the same reason: `sales.profit` has to read as *what the owner keeps on a unit sold*, because that is the number he buys and prices
on. Shopify returns are not booked as reversal rows the way Amazon's are, so on this channel the haircut is the ONLY place return cost
is modelled at all — removing it would overstate what a Shopify sale keeps, with nothing else picking up the slack. Do not "simplify"
it away. (docs/update-amazon-port.md §2.11 is the long version of this argument, measured.)

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
 * toNumber(v) -> number | null
 * Defensive parse for the legacy VARCHAR money columns. Anything that isn't a finite number (NULL, '', 'RRP', 'n/a') becomes null so
 * the caller ends up storing NULL rather than NaN. Mirrors the try/except float() the Python does around skusummary.cost.
 */
function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

module.exports = { shopifyProfit, toNumber };
