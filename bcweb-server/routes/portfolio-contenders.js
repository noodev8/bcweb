/*
=======================================================================================================================================
API Route: portfolio_contenders
=======================================================================================================================================
Method: GET
Purpose: Winners screen — the CONTENDERS tab, and THE REASON THE SCREEN IS WORTH BUILDING. WINNERS is a scoreboard; this is the only
         part of the screen that produces an action.

         It answers "which of my young products are about to become winners?" — and it turns a 180-day wait into a 30-day answer.

         Grain: Shopify STYLE (`groupid`), styles under MATURITY_DAYS old. These headers are the spec — there is no doc.

THE EVIDENCE THIS ROUTE IS BUILT ON (measured 2026-09-22 across 212 mature styles — first sale between 2023-09 and 2026-03).
Profit in a style's FIRST 30 DAYS ON SALE against whether it went on to clear the winner bar in its first 180:

      profit in first 30d    styles   became winners   conversion
      <= 0                      10          0              0%
      1 - 49                   138         11              8%
      50 - 99                   43         12             28%
      100 - 199                 18         13             72%
      200+                       3          3            100%

  Units work too but far less sharply (11+ units in 30d gives 52%). PROFIT IS THE BETTER SIGNAL — that is why the score is money and
  not volume, and swapping it back would blunt the screen.

WHY ACTING ON IT IS WORTH ANYTHING AT ALL: only 25% of a winner's 180-day profit lands in its first 30 days, and 45% by day 60. OVER
HALF THE VALUE IS STILL AHEAD when the signal fires. A 72%-likely winner with 4 units left is the single most valuable row on this
screen — 116 styles sold out entirely last year and 24 ran out in May-July with a third of the season still to run.

TOO_EARLY IS NOT A BAND, IT IS A REFUSAL TO GUESS. A style with fewer than CONTENDER_WINDOW days on sale CANNOT be scored: its
window is censored, and scoring a censored cohort is precisely the mistake that produced a fictitious hit-rate collapse during the
analysis session. Those rows come back with band TOO_EARLY, conversion_pct null, and are excluded from `expected_winners`. Do not
"fix" this by pro-rating a partial window.

THE BANDS ARE A FITTED MODEL AND THEY GO STALE. They were fitted on 212 mature styles on 2026-09-22 and MUST BE RECALIBRATED
ANNUALLY as more cohorts mature — it is a five-minute query (spec section 8.2). A second known gap: the bands are blended across all
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
    "expected_winners": 20,             // sum of (band count x band conversion), rounded. TOO_EARLY excluded
    "high_confidence_count": 14         // STRONG + LIKELY, the two bands that carry an action
  },
  "contenders": [
    { "groupid": "0051753", "title": "...", "brand": "Birkenstock",
      "first_sale": "2026-07-02", "days_on_sale": 82,
      "profit_first_30d": 148.20,       // THE SCORE. null when the style is TOO_EARLY
      "band": "LIKELY",                 // STRONG | LIKELY | POSSIBLE | WEAK | DEAD | TOO_EARLY
      "conversion_pct": 72,             // null when TOO_EARLY
      "profit_so_far": 205.40,          // lifetime, for context — NOT the score
      "units_so_far": 31,
      "stock_units": 4, "out_of_stock": false },
    ...
  ]
}
Sort: band strongest-first, then profit_first_30d descending — EXCEPT that out-of-stock rows in STRONG and LIKELY float to the very
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
