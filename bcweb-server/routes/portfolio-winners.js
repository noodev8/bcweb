/*
=======================================================================================================================================
API Route: portfolio_winners
=======================================================================================================================================
Method: GET
Purpose: Winners screen — the WINNERS tab. The bird's-eye view of the business as a portfolio of earning assets: every style that
         earned more than the bar in the rolling 12 months. Plus the recorded TREND of that count over time.

         THERE IS NO AGE TEST. The spec's section 2 carried one (age >= 180 days) but its own headline figures were measured
         without it, and the owner settled the contradiction in favour of the window on 2026-09-22. £200 is already an annual bar,
         so a style clearing it in four months is outperforming rather than unproven, and gating on age hid the newest earners from
         the very count the screen exists to grow. See MATURITY_DAYS in utils/portfolio.js for the full argument — it survives
         there as a CONTENDERS-only rule.

         "Each product is a tiny asset that is earning for me. I want as many as I can get. That 20 should be 30 next year."
         — owner, 2026-09-22. The COUNT is the tracked number; everything else on the screen supports it.

         Grain: Shopify STYLE (`groupid`). Strategy: docs/portfolio-model.md. THESE HEADERS ARE THE SPEC — the separate build
         spec was deleted 2026-09-22, so record decisions here, not in a doc.

         THE DEFINITION LIVES IN utils/portfolio.js, not here — it is shared with the snapshot writer so the number on the chart can
         never be computed differently from the number in the headline. The three calls that are easiest to get wrong (age anchored
         on MIN(sales.solddate) and never created_at; all channels counted; SUM(profit) with no qty multiplier) are argued out in
         that file's header.

         READ-ONLY, AND DELIBERATELY SO. This GET computes TODAY's figures live — so the headline is never stale — and stores
         NOTHING. Recording a trend point is a separate, deliberate act: POST /portfolio-snapshot-update, the "Update now" button.
         Mirrors the Stock Position and Birk Availability split, and for the same reason: a series that grew every time someone
         opened the page would measure browsing, not the business.

THE REPORT UNDER THE COUNT (added 2026-09-22, owner):
         "I can then decide whether I'm focussing on high volume low profit items and what the sweet spot might be. Unless you
          can also give me a report here. ie. I shouldn't be focussing on the low 20 items if they only yield another £2 for the
          year."

         `summary.ladder`   — the DISTRIBUTION behind the count: the same styles cut into rungs, each stating what it earned,
                              what a typical style in it earns per unit, and what one more product there would be worth. The
                              rungs tile the bar exactly, so the winner count is the sum of the rungs above £200.
         `summary.movement` — whether the range already owned is CLIMBING or SLIDING. The count cannot see this; a portfolio can
                              add winners at the bottom every year while what it owns slips a rung. See bandMovement().

         ⚠ THE BAR IS £200 AND THERE IS NO CONTROL FOR IT. A dial offering £300/£500/£1,000 was built here the same day and
           removed within hours — "We've got too many competing numbers. Put it back to normal 200. The 80 is my number."
           The analysis survives in utils/portfolio.js's headers, which is where it belongs; what the dial added to the SCREEN
           was three rival versions of the one figure it exists to grow. Do not rebuild it. `summary.bar` states the ruler.

Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional integer >= 1 — trailing window of recorded history to return (default 365). Cap 730 (the retention limit).
         The default is a YEAR, not the 90 days Stock Position uses: the winner count moves at the pace of buying decisions and a
         quarter of it is a nearly flat line.

Success Response:
{
  "return_code": "SUCCESS",
  "days": 365,
  "summary": {                          // real figures, measured 2026-09-22 against the live DB
    "bar": 200,                         // WHICH bar these top-level figures were taken at — always the TRACKED one
    "winner_count": 80,
    "winner_count_prior_year": 58,      // the same test applied to the 12 months before this one
    "joined_this_year": 38,             // winner now, not a winner a year ago
    "left_this_year": 16,               // winner a year ago, not a winner now
    "total_styles": 303,                // styles that traded at all in the window — the denominator for the share
    "winner_share_pct": 26,             // 80 of 303. Whole percent; null if the denominator is unknown
    "total_profit_12m": 52129.60,       // in the payload but NOT shown on screen (owner: "I don't care about values")
    "total_revenue_12m": 367544.55,     // gross, across the winners only. Shown; NOT snapshotted, so never on the trend
    "total_units_12m": 7615,
    "total_units_prior_12m": 5189,      // what THIS year's winners shifted LAST year — like-for-like, not last year's set
    "by_brand": [ { "brand": "Birkenstock", "winners": 59, "units": 2504, "revenue": 167630.21 }, ... ],

    // THE REPORT. Rungs tile the bar exactly, low to high, so the winner count is the sum of the rungs above £200.
    // `from` is an EXCLUSIVE floor (null = open below), `to` an INCLUSIVE ceiling (null = open above).
    "ladder": [
      { "from": null, "to": 0,    "is_winner_band": false, "styles": 37,  "profit":  -1198.03, "units":  288,
        "profit_per_style":  -32.38, "profit_per_unit": -4.16, "units_per_style":   7.78 },
      { "from": 0,    "to": 200,  "is_winner_band": false, "styles": 186, "profit":  13962.03, "units": 2298,
        "profit_per_style":   75.06, "profit_per_unit":  6.08, "units_per_style":  12.35 },
      { "from": 200,  "to": 300,  "is_winner_band": true,  "styles": 29,  "profit":   6886.16, "units":  884,
        "profit_per_style":  237.45, "profit_per_unit":  7.79, "units_per_style":  30.48 },
      { "from": 300,  "to": 500,  "is_winner_band": true,  "styles": 22,  "profit":   8966.03, "units": 1207,
        "profit_per_style":  407.55, "profit_per_unit":  7.43, "units_per_style":  54.86 },
      { "from": 500,  "to": 1000, "is_winner_band": true,  "styles": 16,  "profit":  10723.94, "units": 1055,
        "profit_per_style":  670.25, "profit_per_unit": 10.16, "units_per_style":  65.94 },
      { "from": 1000, "to": null, "is_winner_band": true,  "styles": 13,  "profit":  25553.47, "units": 4469,
        "profit_per_style": 1965.65, "profit_per_unit":  5.72, "units_per_style": 343.77 }
    ],
    // Each rung also carries "profit_per_unit_typical" — the MEDIAN per-style rate, which is what the screen draws. The
    // aggregate above is dominated by each rung's busiest styles; the medians are 6.61 / 10.89 / 10.44 / 12.44 / 4.75.

    // IS THE RANGE CLIMBING OR SLIDING? Over styles that traded in BOTH windows. See bandMovement().
    "movement": {
      "styles": 155, "up": 38, "same": 76, "down": 41, "net": -3,
      "top_band_floor": 1000, "top_band_styles": 13,      // 12 of the 13 above £1,000 were already above £500 a year ago:
      "established_floor": 500, "top_band_established": 12 // big earners are grown, not found
    }
  },
  "winners": [
    { "groupid": "0051753", "title": "Arizona Birko-Flor White", "brand": "Birkenstock",
      "profit_12m": 2841.55, "units_12m": 210,
      "profit_prior_12m": 1980.10,      // null when the style is younger than 24 months (no real prior year)
      "direction": "GROWING",           // GROWING | FLAT | SHRINKING | NEW
      "first_sale": "2024-03-14", "days_on_sale": 922,
      "stock_units": 0 },               // shown, NEVER filtered on — an out-of-stock winner still earned what it earned
    ...
  ],                                    // profit_12m descending — the biggest asset first
  "history": [                          // RECORDED snapshots only, oldest -> newest. Empty until the first "Update now"
    { "date": "2026-09-22", "winner_count": 80, "winner_count_prior_year": 58,
      "joined_this_year": 38, "left_this_year": 16, "total_profit_12m": 52196.25,
      "young_styles": 99, "expected_winners": 20, "high_confidence_count": 14 },
    ...
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { computeWinners } = require('../utils/portfolio');
const logger = require('../utils/logger');

router.use(verifyToken);

// A year of history by default — see the query-param note above.
const DEFAULT_HISTORY_DAYS = 365;
// Matches the 2-year prune in routes/portfolio-snapshot-update.js. Asking for more than exists is harmless, but the cap keeps the
// two numbers visibly in step.
const MAX_HISTORY_DAYS = 730;

router.get('/', async (req, res) => {
  try {
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days) || days < 1) days = DEFAULT_HISTORY_DAYS;
    if (days > MAX_HISTORY_DAYS) days = MAX_HISTORY_DAYS;

    // Today's live figures and the stored series are independent reads — run them together.
    const [{ summary, winners }, hist] = await Promise.all([
      computeWinners(),
      query(
        `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date,   -- cast in SQL; never hand a pg DATE to toISOString()
                winner_count, winner_count_prior_year, joined_this_year, left_this_year,
                total_profit_12m, young_styles, expected_winners, high_confidence_count, total_styles
           FROM portfolio_snapshot
          WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
          ORDER BY snapshot_date ASC`,
        [days]
      ),
    ]);

    // pg hands NUMERIC back as a STRING. Coerce here so the client never has to, and the chart never plots a string.
    const history = hist.rows.map((r) => ({
      date: r.date,
      winner_count: Number(r.winner_count) || 0,
      winner_count_prior_year: Number(r.winner_count_prior_year) || 0,
      joined_this_year: Number(r.joined_this_year) || 0,
      left_this_year: Number(r.left_this_year) || 0,
      total_profit_12m: Number(r.total_profit_12m) || 0,
      young_styles: Number(r.young_styles) || 0,
      expected_winners: Number(r.expected_winners) || 0,
      high_confidence_count: Number(r.high_confidence_count) || 0,
      total_styles: Number(r.total_styles) || 0,
      // Derived at read time from the two stored facts, never stored itself — one number cannot then disagree with the other.
      // 0 means the row predates the total_styles column and genuinely does not know its denominator: null, not a fake 0%.
      winner_share_pct: Number(r.total_styles) > 0
        ? Math.round((Number(r.winner_count) / Number(r.total_styles)) * 100)
        : null,
    }));

    return res.json({ return_code: 'SUCCESS', days, summary, winners, history });
  } catch (err) {
    logger.error('[portfolio-winners] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load winners' });
  }
});

module.exports = router;
