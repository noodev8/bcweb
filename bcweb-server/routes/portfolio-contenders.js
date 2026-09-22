/*
=======================================================================================================================================
API Route: portfolio_contenders
=======================================================================================================================================
Method: GET
Purpose: Winners screen — the CONTENDERS tab, and THE REASON THE SCREEN IS WORTH BUILDING. WINNERS is a scoreboard; this is the only
         part of the screen that produces an action.

         It answers "which of my young products are about to become winners?" — and it turns a year's wait into a 30-day answer.

         SCORED ON GROSS REVENUE since 2026-09-22, matching the winner bar. The owner's route is PRODUCT FIND > REVENUE > PROFIT >
         KEEP/DROP; this tab is the leading edge of the FIND step, so it runs on the FIND metric. Profit is still on every row as
         context and decides nothing here.

         Grain: Shopify STYLE (`groupid`), styles under MATURITY_DAYS old. These headers are the spec — there is no doc.

THE EVIDENCE THIS ROUTE IS BUILT ON — REFITTED ON REVENUE 2026-09-22, when the winner bar became a revenue bar.
GROSS REVENUE in a style's FIRST 30 DAYS ON SALE against whether it went on to clear WINNER_BAR within its first 365 days.
Measured over the 163 styles with a full year on sale; base rate 44%:

      revenue in first 30d   styles   became winners   conversion
      < 100                     35          6             17%
      100 - 299                 60         17             28%
      300 - 749                 55         36             65%
      750+                      13         12             92%

  WHY REVENUE AND NOT UNITS, honestly stated: on THIS outcome units are a comparable predictor, not a much worse one (8+ units in
  30d converts at 72%, 15+ at 86%, against 65% and 92% for the revenue bands). The old header's claim that money beats volume was
  measured against the old profit outcome and no longer holds — do not repeat it. Revenue is the score because it is THE SAME
  METRIC AS THE BAR: the pipeline and the count it feeds are then read with one ruler, and "expected winners" is a forecast of the
  very number on the Winners screen rather than of a correlated proxy. A units score would reintroduce the drift this file exists
  to prevent. (It would also mis-rank a £120 sandal against a £45 one, which the revenue score handles for free.)

WHY ACTING ON IT IS WORTH ANYTHING AT ALL: only 12% of a winner's FIRST-YEAR revenue lands in its first 30 days, and 19% by day 60.
NEARLY NINE POUNDS IN TEN IS STILL AHEAD when the signal fires — a stronger argument than the profit-era version of this paragraph
(which said "over half"), because the outcome window is now the full year the bar is measured over. A 65%-likely winner with 4 units
left is the single most valuable row on this screen — 116 styles sold out entirely last year and 24 ran out in May-July with a third
of the season still to run.

TOO_EARLY IS NOT A BAND, IT IS A REFUSAL TO GUESS. A style with fewer than CONTENDER_WINDOW days on sale CANNOT be scored: its
window is censored, and scoring a censored cohort is precisely the mistake that produced a fictitious hit-rate collapse during the
analysis session. Those rows come back with band TOO_EARLY, conversion_pct null, and are excluded from `expected_winners`. Do not
"fix" this by pro-rating a partial window.

THE BANDS ARE A FITTED MODEL AND THEY GO STALE. They were fitted on 163 mature styles on 2026-09-22 and MUST BE RECALIBRATED
ANNUALLY as more cohorts mature — it is a five-minute query (spec section 8.2). The fit needs a FULL YEAR of history per style now
that the outcome window is 365 days, so it draws on older cohorts than the profit-era fit did; that is the price of predicting the
actual bar instead of a six-month proxy for it, and it is worth paying. A second known gap: the bands are blended across all
seasons, and a style whose first 30 days fall in June faces a very different demand backdrop to one starting in December. Whether
that needs a seasonal adjustment is UNMEASURED (spec section 8.1) — the front end carries a note saying so, and it should stay
there until someone has checked.

DEFINITION CALLS, same as the WINNERS route and for the same reasons (see its header for the full argument): age anchored on
MIN(sales.solddate) and NEVER skusummary.created_at; ALL CHANNELS count, not just Shopify; no `shopify = 1` test; profit is
SUM(sales.profit) with no qty multiplier; returns excluded via qty > 0; profit is CONTRIBUTION, before advertising.

THE DEFINITION AND THE SQL LIVE IN utils/portfolio.js, not here — shared with the snapshot writer so the figures recorded as a
trend point can never be computed differently from the ones on screen. This route is the HTTP shell around computeContenders().

Cost: one grouped scan of sales, one self-join back to it for the 30-day window, one stock scan. No N+1.
Requires auth.
=======================================================================================================================================
Request Payload: none (GET). No query params in v1.

Success Response:
{
  "return_code": "SUCCESS",
  "summary": {
    "young_styles": 99,                 // every style under MATURITY_DAYS old, TOO_EARLY ones included
    "expected_winners": 38,             // sum of (band count x band conversion), rounded. TOO_EARLY excluded
    "high_confidence_count": 14         // STRONG + LIKELY, the two bands that carry an action
  },
  "contenders": [
    { "groupid": "0051753", "title": "...", "brand": "Birkenstock",
      "first_sale": "2026-07-02", "days_on_sale": 82,
      "revenue_first_30d": 448.20,      // THE SCORE: gross revenue, first 30 days. null when the style is TOO_EARLY
      "band": "LIKELY",                 // STRONG | LIKELY | POSSIBLE | WEAK | TOO_EARLY (there is no DEAD band — see BANDS)
      "conversion_pct": 65,             // null when TOO_EARLY
      "revenue_so_far": 1205.40,        // lifetime gross, for context — NOT the score
      "profit_so_far": 205.40,          // lifetime contribution. CONTEXT ONLY — nothing on this screen is decided on profit
      "units_so_far": 31,
      "stock_units": 4, "out_of_stock": false },
    ...
  ]
}
Sort: band strongest-first, then revenue_first_30d descending — EXCEPT that out-of-stock rows in STRONG and LIKELY float to the very
top of the whole list regardless. That block is the reorder queue and it is the point of the tab.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { computeContenders } = require('../utils/portfolio');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { summary, contenders } = await computeContenders();
    return res.json({ return_code: 'SUCCESS', summary, contenders });
  } catch (err) {
    logger.error('[portfolio-contenders] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load contenders' });
  }
});

module.exports = router;
