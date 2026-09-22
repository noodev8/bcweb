/*
=======================================================================================================================================
API Route: portfolio_winners
=======================================================================================================================================
Method: GET
Purpose: Winners screen — the WINNERS tab. The bird's-eye view of the business as a portfolio of earning assets: every style that
         TURNED OVER more than the bar in the rolling 12 months. Plus the recorded TREND of that count over time.

         THE BAR IS GROSS REVENUE (£1,500), NOT PROFIT — changed 2026-09-22 by the owner, who named the route the screen sits on:
         "PRODUCT FIND > REVENUE > PROFIT > KEEP/DROP. We have to keep loading and building our products with revenue. The rest
         are for different departments to take care of." This tab is the FIND step. `sales.profit` is contribution before
         advertising, so a profit bar was measuring revenue through an incomplete margin and hiding the ad cost that actually
         decides keep-or-drop; it also dropped thin-margin styles that sell brilliantly, which are precisely the ones to load and
         build. Profit is still in every payload — the band report states what each revenue rung earns — it just no longer decides
         who is a winner. The whole argument, and where £1,500 came from, is on WINNER_BAR in utils/portfolio.js.

         THERE IS NO AGE TEST. The spec's section 2 carried one (age >= 180 days) but its own headline figures were measured
         without it, and the owner settled the contradiction in favour of the window on 2026-09-22. The bar is already an annual bar,
         so a style clearing it in four months is outperforming rather than unproven, and gating on age hid the newest earners from
         the very count the screen exists to grow. See MATURITY_DAYS in utils/portfolio.js for the full argument — it survives
         there as a CONTENDERS-only rule.

         "Each product is a tiny asset that is earning for me. I want as many as I can get. That 20 should be 30 next year."
         — owner, 2026-09-22. The COUNT is the tracked number; everything else on the screen supports it.

         Grain: Shopify STYLE (`groupid`). Strategy: docs/portfolio-model.md. THESE HEADERS ARE THE SPEC — the separate build
         spec was deleted 2026-09-22, so record decisions here, not in a doc.

         THE DEFINITION LIVES IN utils/portfolio.js, not here — it is shared with the snapshot writer so the number on the chart can
         never be computed differently from the number in the headline. The three calls that are easiest to get wrong (age anchored
         on MIN(sales.solddate) and never created_at; all channels counted; revenue as SUM(soldprice * qty) while profit is a line
         total needing no qty multiplier) are argued out in that file's header.

         READ-ONLY, AND DELIBERATELY SO. This GET computes TODAY's figures live — so the headline is never stale — and stores
         NOTHING. Recording a trend point is a separate, deliberate act: POST /portfolio-snapshot-update, the "Update now" button.
         Mirrors the Stock Position and Birk Availability split, and for the same reason: a series that grew every time someone
         opened the page would measure browsing, not the business.

THE BAR TOGGLE, AND THE REPORT UNDER IT (added 2026-09-22, owner):
         "We have a number for winners based on making £200 profit in a year. I wonder, is it easy enough to give me a toggle so
          I can see what the numbers are for £300, £500 or 1k profit. I can then decide whether I'm focussing on high volume low
          profit items and what the sweet spot might be. Unless you can also give me a report here. ie. I shouldn't be focussing
          on the low 20 items if they only yield another £2 for the year."

         Both, because they answer different halves and neither is sufficient alone:

           `summary.bars`   — the WHOLE summary re-measured at every mark on WINNER_BAR_LADDER (£1,500/£2,500/£5,000/£10,000 of
                              revenue since 2026-09-22; it was 200/300/500/1000 of profit when the quote above was written). ONE
                              payload, not fetched per bar, so the toggle is instant AND the four readings provably come from the
                              same rows. A `bar` query param was the obvious alternative and is worse: four round-trips over a
                              moving `sales` table, and four chances for the screen to show a count the headline never produced.
           `summary.ladder` — the DISTRIBUTION. A count at a higher bar cannot say what the gap between two bars is WORTH, and the
                              worth is the actual decision. See profitLadder() in utils/portfolio.js for what the columns showed
                              on the day and why "earned per unit" is the one that answers the high-volume/low-profit question.

         ⚠ THE TOGGLE IS A READING, NOT A SETTING. Nothing about it reaches the database. summary's own top-level fields are
           bars[0] — the TRACKED £1,500 bar — spread in place, so POST /portfolio-snapshot-update records the tracked figure
           whatever the screen happens to be displaying, and the trend line never develops a step caused by someone browsing.
           When the tracked bar itself moves, the snapshot's `bar_metric`/`bar_value` stamp keeps the two series apart and this
           route draws only the ruler in force (migrations/20260922d) — the history is kept, not cleared.

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

    // THE TOGGLE. Every field above, re-measured at each mark. bars[0] IS the object above (same bar, same numbers).
    "bars": [
      { "bar": 200,  "winner_count": 80, "winner_count_prior_year": 58, "winner_share_pct": 26, "total_units_12m": 7615, ... },
      { "bar": 300,  "winner_count": 51, "winner_count_prior_year": 41, "winner_share_pct": 17, "total_units_12m": 6731, ... },
      { "bar": 500,  "winner_count": 29, "winner_count_prior_year": 23, "winner_share_pct": 10, "total_units_12m": 5524, ... },
      { "bar": 1000, "winner_count": 13, "winner_count_prior_year":  7, "winner_share_pct":  4, "total_units_12m": 4469, ... }
    ],

    // THE REPORT. Bands tile the ladder exactly, low to high, so the count at any mark is the sum of the bands above it.
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
    ]
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
const { computeWinners, WINNER_METRIC, WINNER_BAR } = require('../utils/portfolio');
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
          -- ONLY THE ROWS TAKEN WITH TODAY'S RULER. The bar changed from £200 PROFIT to £1,500 GROSS REVENUE on 2026-09-22 and
          -- migrations/20260922d stamps every row with the one it was measured against. Plotting both on one line would draw a
          -- cliff that is an artefact of the definition, not of the business. The old rows stay in the table — they were true on
          -- the day — they are simply not this chart's series any more, so the trend restarts from the change.
          WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
            AND bar_metric = $2 AND bar_value = $3
          ORDER BY snapshot_date ASC`,
        [days, WINNER_METRIC, WINNER_BAR]
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
