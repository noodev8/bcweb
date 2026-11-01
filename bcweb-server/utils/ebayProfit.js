/*
=======================================================================================================================================
Module: utils/ebayProfit.js
=======================================================================================================================================
Purpose: The per-unit NET profit of an eBay sale — the number written to `sales.profit` on every EBY row (utils/ebayOrderSync.js).
         The eBay counterpart of utils/shopifyProfit.js, built the same way ON PURPOSE so the two channels compare on the Sales screen:
         same VAT, same flat packing + Royal Mail, same /1.2 returns haircut. Only the platform fee differs.

THE FORMULA (per unit)
    Sale     = item price + postage the buyer paid (VAT-inclusive). Postage IS counted: eBay charges its fee on it, so leaving it out
               would count the fee without the income (auctions carry £4.50; fixed-price listings are free postage, 0).
    VAT      = Sale / 6
    eBay fee = 11.9% + 0.35% of Sale, + the per-ORDER fixed fee (£0.40 when the order total is over £10, else £0.30) shared across
               the order's units. ALL EX VAT — the owner reclaims the VAT on eBay's fees (2026-10-31), so the cost is the net figure.
    Expenses = eBay fee + packing/wages 1.00 + Royal Mail 3.44
    Profit   = (Sale - VAT - cost - Expenses) / 1.2

WHERE THE RATES COME FROM: eBay's fee breakdown for order 22-15343-31982 (2026-10-30, £11.99): final value fee 11.9% (Clothes, Shoes &
Accessories) = £1.43, regulatory operating fee 0.35% = £0.04, fixed £0.40 ("order total £10.01+"), + 20% VAT = £2.25 — which matches
the transaction report to the penny. The £0.30 at £10 or less is eBay's published rate, not yet seen on one of our orders.

ALWAYS ROYAL MAIL, EVEN WHEN THE PAIR GOES FROM FBA (owner, 2026-11-01: "Dont separate this profit. Just use the Royal mail so I can
compare. If it is MCF I will take the hit"). An MCF order really costs ~£5.35 ex VAT against the £4.44 here; that gap is deliberately
not modelled.

NULL when cost is unusable — same load-bearing rule as shopifyProfit: the Sales screen shows "—" rather than a wrong profit.
=======================================================================================================================================
*/

const VAT_DIVISOR = 6;              // VAT-inclusive price / 6 = the VAT in it
const FINAL_VALUE_RATE = 0.119;     // eBay final value fee, Clothes, Shoes & Accessories (ex VAT)
const REGULATORY_RATE = 0.0035;     // eBay regulatory operating fee (ex VAT)
const FIXED_OVER_10 = 0.40;         // per-order fixed fee when the order total is over £10 (ex VAT)
const FIXED_10_OR_LESS = 0.30;      // per-order fixed fee at £10 or less (ex VAT) — eBay's published rate
const FIXED_THRESHOLD = 10;         // "Order total £10.01+"
const PACKING = 1.00;               // packaging + wages — the same flat estimate as Shopify
const ROYAL_MAIL = 3.44;            // outbound postage — the same flat estimate as Shopify
const RETURNS_DIVISOR = 1.2;        // the same "cover refunds" haircut as Shopify and Amazon

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/*
 * ebayProfit({ price, postage, cost, orderTotal, orderUnits }) -> number | null
 *   price       per-unit item price, VAT-inclusive
 *   postage     per-unit share of the postage the buyer paid (0 for free postage)
 *   cost        per-unit cost of goods (skusummary.cost — a legacy VARCHAR, may be junk)
 *   orderTotal  the whole order's total incl. postage — picks the fixed fee
 *   orderUnits  units in the whole order — the fixed fee is per ORDER, so each unit carries its share
 */
function ebayProfit({ price, postage = 0, cost, orderTotal, orderUnits = 1 }) {
  const p = toNumber(price);
  const c = toNumber(cost);
  if (p === null || c === null) return null;
  const sale = p + (toNumber(postage) || 0);
  const vat = sale / VAT_DIVISOR;
  const total = toNumber(orderTotal);
  const fixed = (total !== null && total <= FIXED_THRESHOLD) ? FIXED_10_OR_LESS : FIXED_OVER_10;
  const fee = (FINAL_VALUE_RATE + REGULATORY_RATE) * sale + fixed / Math.max(Number(orderUnits) || 1, 1);
  const expenses = fee + PACKING + ROYAL_MAIL;
  return Math.round(((sale - vat - c - expenses) / RETURNS_DIVISOR) * 100) / 100;
}

module.exports = { ebayProfit };
