/*
=======================================================================================================================================
Util: amzProfit
=======================================================================================================================================
Purpose: THE Amazon profit calculation. One function, one place. Everything that needs an Amazon per-unit profit calls this —
         sales.profit at import time, and anything projected back to PowerBuilder.

WHY THIS EXISTS
The legacy app carried THREE different Amazon profit formulas that disagreed with each other, and the one writing the number the
Analytics module reads was the crudest of the three:

  of_updateamzdatadb:526-548   15.3% referral + real per-SKU fbafee + VAT + £0.80 DPD          -> skumap.amzprofit (nothing reads it)
  of_amzsalesload:198-206      15%   referral + FLAT £3 FBA + VAT + £1.83 catch-all, all ÷1.2  -> sales.profit  (Analytics reads this)
  of_filteramzdisplay:255-277  15%   referral + FLAT £3.05 FBA + 2% digital + storage
                               + £1 DPD + £0.50 wages, all ÷1.2                                -> the PowerBuilder screen

Decision D4 (design doc §4) settles it as the formula below. Three things are worth knowing about how it was arrived at, because
each looks like a mistake if you don't know:

1. REFERRAL IS 15%, NOT 15.3%. Measured, not assumed: `estimated-referral-fee-per-unit / your-price` across all 260 rows of the
   2026-07-28 fee report gives 0.1500 (x188), 0.1499 (x42), 0.1501 (x21), 0.1503 (x8), 0.1498 (x1) — 15% with penny-rounding noise.
   The 15.3% in the legacy code is a stale rate.

2. THE ÷1.2 RETURNS ADJUSTMENT STAYS. It is the owner's long-standing figure and it is deliberate: `sales.profit` must read as
   "what I can expect to KEEP on a unit I sell", because that is the number buying and pricing decisions get made on. A figure that
   excluded returns would be profit-if-it-sticks, which overstates what you keep by the return rate.
   It was briefly removed on the theory that it double-counted the return reversal rows. It does not: a reversal makes a returned
   sale net to zero and takes the haircut with it, so the haircut only ever lands on sales that STUCK. Measured against an explicit
   per-return cost model over 12 months it removes £4,670.65 vs £4,531.22 — within 3.1%. It is a good aggregate proxy, and it is
   cheap. Its one real weakness is resolution: it charges every SKU a flat 16.7% when real return rates run 5.4% to 33.0%, so a
   high-return style still looks better than it is. That is a job for a per-SKU expected-keep metric in the pricing screens, NOT a
   reason to take returns out of this field.

3. THE ESTIMATES ARE DELIBERATELY HIGH. Owner's words: "purposely estimated high so that if I can make a profit with these, I am
   safe." So this is a CONSERVATIVE FLOOR, not an accounting figure, and the padding is intentional — do not "correct" the courier
   or wages numbers downward because they look generous. The governing principle:
       real data where we have it (referral %, per-SKU FBA fee) — deliberately pessimistic where we're estimating (courier, wages).

NOT IN SCOPE: a breakeven/floor price. The legacy of_updateamzdatadb:543-548 floor was explicitly dropped per D4 — the owner no
longer uses it, and /amz-apply's existing guard is unchanged by this module.
=======================================================================================================================================
*/

// --- Rate card ------------------------------------------------------------------------------------------------------------------
// Kept as named constants rather than inline numbers so the assumptions are greppable and reviewable in one block. If Amazon changes
// a rate, this is the only place to edit.
const REFERRAL_RATE = 0.15;   // Amazon referral fee. Verified against the fee report (see note 1 above).
const DIGITAL_RATE = 0.02;    // Digital Services Fee: 2% of (referral + FBA). Real Amazon UK charge; only the display formula had it.
const COURIER_EACH = 1.00;    // Inbound courier per unit (DPD). Estimate, deliberately high.
const WAGES_EACH = 0.50;      // Handling/labour per unit. Estimate, deliberately high.
const VAT_DIVISOR = 6;        // UK VAT at 20% on a gross price = price / 6. Legacy convention, kept (tax=1 means VAT-registered sale).

// --- Returns ----------------------------------------------------------------------------------------------------------------------
// One adjustment, applied to every sale, so the profit field already has returns in it (see note 2 above).
// Roughly "shown profit minus 90p" at the portfolio's 15.5% return rate.
const RETURNS_DIVISOR = 1.2;   // covers ALL return costs. Do not add per-return fees on top - that would charge them twice.


// The last-resort FBA fee for a SKU that has NEVER had a real one from the fee report. Same value the legacy code used. Note it is
// on the HIGH side of reality — the 2026-07-28 fee report has a median of £3.08 and only 15 of 259 SKUs above £3.39 — which is the
// conservative direction, consistent with note 3.
const FBA_FEE_FALLBACK = 3.39;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Strict numeric coercion. Number(null) is 0 and Number('') is 0, which is exactly the wrong answer for "we don't know this value":
 * a missing cost would coerce to £0 and report the whole sale price as profit. Anything not genuinely numeric returns null here so
 * the caller can refuse to compute rather than publish a confident wrong number.
 */
function strictNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Per-unit Amazon profit.
 *
 * @param {object}  args
 * @param {number}  args.price    gross selling price per unit (what the customer paid, VAT inclusive when taxable)
 * @param {number}  args.cost     unit cost from skusummary.cost
 * @param {number}  [args.fbafee] real per-SKU FBA fulfilment fee; falls back to FBA_FEE_FALLBACK when unknown
 * @param {number}  [args.tax]    1 = VAT applies (deduct price/6), anything else = no VAT
 * @returns {{ profit: number|null, breakdown: object }}
 *          profit is null when price or cost is unknown — an unknown input must never silently become a £0 cost, which would
 *          report a wildly overstated profit. Callers write NULL rather than guessing.
 */
function amzProfit({ price, cost, fbafee, tax }) {
  const p = strictNum(price);
  const c = strictNum(cost);

  if (p === null || p <= 0) return { profit: null, breakdown: { reason: 'NO_PRICE' } };
  // cost <= 0 is treated as UNKNOWN, not as free stock. skusummary.cost is a legacy varchar that can hold junk or blanks, and in
  // this catalogue a genuine zero cost does not exist — a 0 here always means missing data. Computing on it would report the entire
  // sale price as profit, which is the most damaging way for this function to be wrong.
  if (c === null || c <= 0) return { profit: null, breakdown: { reason: 'NO_COST' } };

  const feeRaw = strictNum(fbafee);
  const feeIsFallback = feeRaw === null || feeRaw <= 0;
  const fee = feeIsFallback ? FBA_FEE_FALLBACK : feeRaw;

  // VAT comes off the gross price first — everything below is computed on the gross price, as all three legacy formulas did.
  const vat = Number(tax) === 1 ? p / VAT_DIVISOR : 0;
  const gross = p - vat - c;

  const referral = p * REFERRAL_RATE;
  const digital = (referral + fee) * DIGITAL_RATE;
  const other = COURIER_EACH + WAGES_EACH;

  // Divide by 1.2 to cover returns. This is the OWNER'S long-standing adjustment, kept deliberately: `sales.profit` must read as
  // "what I can expect to keep on a unit I sell", because that is the number buying and pricing decisions are made on. Measured
  // against an explicit per-return cost model over 12 months it is within 3.1% (£4,670.65 vs £4,531.22) — a good aggregate proxy.
  // Because it lives here, the return row must stay a BARE reversal (see returnProfit) or the cost would be charged twice.
  const profit = (gross - referral - fee - digital - other) / RETURNS_DIVISOR;

  return {
    profit: round2(profit),
    breakdown: {
      price: round2(p),
      vat: round2(vat),
      cost: round2(c),
      gross: round2(gross),
      referral: round2(referral),
      fba: round2(fee),
      fbaIsFallback: feeIsFallback,
      digital: round2(digital),
      courier: COURIER_EACH,
      wages: WAGES_EACH,
      profit: round2(profit),
    },
  };
}

/**
 * The profit to record on a RETURN row — per unit, and always negative.
 *
 * The legacy version (of_amzsalesload:317-326) was a bare reversal: negate the original sale's per-unit profit and stop. That models
 * a return as costing nothing, which is wrong in three ways, all corrected here. Sale and return rows are read together, so what
 * matters is what the PAIR nets to:
 *
 *     sellable return    ->  sale (+margin) + return (-margin -fees)          = the fees. Right: you lost the sale and paid to.
 *     unsellable return  ->  sale (+margin) + return (-margin -fees -cost)    = fees + the stock. Right: the unit is gone.
 *
 * Note the interplay with the sale row, which is easy to get wrong in either direction: the sale already deducted the referral and
 * FBA fees, and the reversal credits BOTH back. Amazon returns the referral (less the admin fee) but not the fulfilment fee — so the
 * admin fee and the whole FBA fee are re-deducted here. Anything not re-deducted is, in effect, refunded.
 *
 * Courier and wages are deliberately NOT re-deducted. They are credited back by the reversal, which is right for a sellable unit:
 * it goes back on the shelf and the next sale of it will be charged £1.50 again. Re-deducting here would charge them twice for one
 * physical journey.
 *
 * @param {object}      args
 * @param {number|null} args.originalProfit  matched sale row's profit (for its WHOLE qty)
 * @param {number|null} args.originalQty     that row's qty
 * @param {number|null} args.cost            unit cost, written off when the unit comes back unsellable
 * @param {string|null} args.disposition     `detailed-disposition` from the returns report; anything but SELLABLE is a write-off
 * @returns {{ profit: number|null, writeOff: number, breakdown: object }}
 *          profit is null when the original sale can't be found — deliberately NOT a fabricated figure. `writeOff` is surfaced
 *          separately so the screen can report stock lost to damage as its own number rather than burying it inside profit.
 */
function returnProfit({ originalProfit, originalQty, cost, disposition }) {
  const op = strictNum(originalProfit);
  const oq = strictNum(originalQty);
  if (op === null || oq === null || oq <= 0) return { profit: null, writeOff: 0, breakdown: { reason: 'NO_ORIGINAL_SALE' } };

  // A BARE reversal, on purpose. The cost of returns is already carried by the /1.2 on every sale row (see amzProfit above), so
  // charging per-return fees here as well would bill the same thing twice. The two designs are alternatives, not layers:
  //     EITHER  /1.2 on sales + bare reversal        <- current, and what the owner reads as expected keep
  //     OR      no haircut + per-return costs here   <- more precise per SKU, but leaves the profit field as "if it sticks"
  // If the per-return model is ever revived, RETURNS_DIVISOR must go back to 1 in the same change.
  const profit = -(op / oq);

  // `disposition` is still read and reported even though it no longer moves the money: stock coming back DEFECTIVE or
  // CUSTOMER_DAMAGED never resells, and a style doing it repeatedly is a supplier problem worth seeing on the import summary.
  const c = strictNum(cost);
  const unsellable = Boolean(disposition) && String(disposition).toUpperCase() !== 'SELLABLE';
  const writeOff = unsellable && c !== null && c > 0 ? c : 0;

  return {
    profit: round2(profit),
    writeOff: round2(writeOff),
    breakdown: { reversedMargin: round2(profit), writeOff: round2(writeOff), disposition: disposition || null, unsellable },
  };
}

module.exports = {
  amzProfit,
  returnProfit,
  REFERRAL_RATE,
  DIGITAL_RATE,
  COURIER_EACH,
  WAGES_EACH,
  FBA_FEE_FALLBACK,
};
