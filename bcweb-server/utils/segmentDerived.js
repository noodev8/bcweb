/*
=======================================================================================================================================
Module: utils/segmentDerived.js
=======================================================================================================================================
Purpose: The DERIVED review clock for pricing areas (docs/segments-spec.md §9). A segment's Shopify (and, later, Amazon) status is no
         longer a manually-set date — it is COMPUTED at read time from the products' own review dates, the same pool triage/losers
         draw from. This keeps the segment and its products from ever disagreeing: there is no second clock to mismatch against.

The read query (in GET /segments and GET /segment) does the grouping in SQL; this helper only turns the resulting counts into the
area-cell shape the UI already understands, so the overview grid and the detail page can never drift on how a derived clock reads.

Derived model (§9.2), for one segment's pricing area:
  candidates  = in-stock, live styles/SKUs in the segment            -> `instock`
  outstanding = candidates that are un-parked (review date null or <= today) -> `outstanding`
  next_wake   = MIN(review date) over the parked candidates          -> soonest a hidden one returns
  dueState:
    off flag set   -> 'off'   (operator says this area isn't this segment's job; short-circuits the count)
    outstanding > 0 -> 'due'  (attention now — reuses the overdue RED, but its own state so the UI shows "12 / 30 waiting")
    outstanding = 0 -> 'ok'   (resting; nextReview = next_wake, "back <date>")

Note the state name 'due' is NEW here (the manual clock never emits it) and maps to the SAME red the overview already uses — no new
UI colour, only a new badge text. daysOverdue is meaningless for a derived clock (nothing is "late"), so it is always 0.
=======================================================================================================================================
*/

const { isoDate } = require('./segmentDue');

/*
 * deriveShopify({ instock, outstanding, nextWake }, off)
 *   counts: the grouped SQL result for one segment (instock/outstanding ints, nextWake a pg DATE or null). Any may be null/undefined
 *           when the segment has no in-stock live styles at all — treated as zero (nothing to price -> 'ok').
 *   off:    the segment_area_state.off flag for this area (operator marked it N/A) — short-circuits to 'off'.
 * Returns { dueState, outstanding, instock, nextReview } — merged onto the area cell by the caller.
 */
function deriveShopify(counts, off) {
  const instock = Number(counts && counts.instock) || 0;
  const outstanding = Number(counts && counts.outstanding) || 0;

  if (off) {
    // Explicitly not this segment's job — don't let a stale underlying count leak through.
    return { dueState: 'off', outstanding: 0, instock, nextReview: null };
  }

  if (outstanding > 0) {
    // Work waiting — red. No nextReview while due (the work is now, not a future wake).
    return { dueState: 'due', outstanding, instock, nextReview: null };
  }

  // Everything in stock is parked into the future (or there is nothing in stock) — resting/green. Show when a parked one returns.
  return { dueState: 'ok', outstanding: 0, instock, nextReview: isoDate(counts && counts.nextWake) };
}

module.exports = { deriveShopify };
