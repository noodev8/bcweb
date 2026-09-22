/*
=======================================================================================================================================
Module: utils/portfolio.js
=======================================================================================================================================
Purpose: The DEFINITION of a winner and a contender, in one place, because THREE callers need the same answer and must never be able
         to disagree about it:

           routes/portfolio-winners.js          GET  — the list + the hero count on screen
           routes/portfolio-contenders.js       GET  — the young styles, banded
           routes/portfolio-snapshot-update.js  POST — "Update now", which RECORDS the count as a trend point

         The third one is why this file exists at all. A snapshot series is worthless if the number being stored is computed by
         slightly different SQL from the number on screen: the chart would drift away from the headline and there would be no way to
         tell which was right. Same shape as utils/stockPosition.js, and for the same reason.

         Read-only. Nothing in here writes — the snapshot route does its own INSERT with the figures this returns.

THE DEFINITIONS (the full argument for each is in routes/portfolio-winners.js's header — THE CODE IS THE SPEC, the build
spec was deleted 2026-09-22 once it was costing more to maintain than it explained):
  - AGE is days since MIN(sales.solddate). NEVER skusummary.created_at, which is a RECORD date — the gap between the two averages
    261 days on the 2024 cohort. Using it produced a fictitious hit-rate collapse during the analysis session.
  - WINNER = profit > WINNER_PROFIT_BAR in the rolling 12 months. THERE IS NO AGE TEST — see the constant's comment for why the
    one the spec originally carried was removed (owner, 2026-09-22).
  - CONTENDER SCORE = profit in the style's first CONTENDER_WINDOW days on sale, banded against a FITTED model (see BANDS).
  - ALL CHANNELS count (Amazon lines are not filtered out — the style is one asset), there is NO `shopify = 1` test (eligibility is
    "did it earn", not "is it still switched on"), profit is SUM(sales.profit) with NO qty multiplier (sales already carries one row
    per physical unit), and returns are excluded by qty > 0 rather than netted.
  - Every money figure is CONTRIBUTION — before advertising. The UI must say "earned", not "profit".
=======================================================================================================================================
*/

const { query } = require('../database');

// ---------------------------------------------------------------------------------------------------------------------------------
// The constants. Named here, documented, deliberately NOT query params until someone needs to vary them — the same pattern as the
// pricing WINNERS/LOSERS bars. They live in this file rather than the routes precisely BECAUSE the snapshot writer shares them: a
// bar that differed between the screen and the recorder would silently poison the trend.
// ---------------------------------------------------------------------------------------------------------------------------------

// Profit (GBP) in the rolling 12 months that makes a style a winner. THIS BAR, OVER THAT WINDOW, IS THE WHOLE TEST — there is no
// age condition (see MATURITY_DAYS below). Left at 200 for v1; may want to move as the portfolio grows — at 250 winners the bar
// that defines the hero number matters more than it does at 80 (spec section 8.4).
//
// ⚠ MOVING THIS BREAKS THE TREND. Every stored snapshot was taken against the bar in force on the day, and nothing in the table
//   records what that bar was. Change it and the chart shows a step that looks like the business moved when only the ruler did.
//   If it ever moves, clear the snapshot history or add the bar to the stored row — do not just edit the number.
const WINNER_PROFIT_BAR = 200;

// Below this age a style is YOUNG and belongs on the CONTENDERS tab. One selling season.
//
// ⚠ THIS IS A CONTENDERS-ONLY RULE. IT IS NOT PART OF THE WINNER TEST, and putting it back there would be a regression, not a
//   tightening. The spec's section 2 originally defined a winner as "age >= 180 days AND profit > £200 in the rolling 12 months",
//   but its own headline figures (79 winners, 58 a year ago) were measured WITHOUT the age test — and 58 reproduces exactly only
//   without it. The owner settled the contradiction on 2026-09-22 in favour of the window:
//
//     "Isn't a winner something that earns over the 12m window through all the seasons? My job is to find as many as possible
//      to increase annual revenue."
//
//   THE ARGUMENT, because it is the kind of thing that gets "tidied" back: £200 IS ALREADY AN ANNUAL BAR. A style that clears it
//   in 132 days has not failed to prove itself — it is running at roughly three times the pace of one that took the full year, so
//   the age gate was excluding the STRONGEST new assets while counting weaker old ones. It also worked directly against the job
//   the screen exists for: with a gate, a product launched in March could not appear in the count until the following March, so
//   the owner's own wins stayed invisible for up to a year while he was trying to grow that very number.
//   Measured on the day: the gate hid 15 styles earning £3,969 between them (80 winners without it, 65 with).
//
//   NOTE ALSO that an age gate does not measure seasonal breadth, which is what "through all the seasons" actually asks for — age
//   and breadth are different things. If that test is ever wanted, build it explicitly (e.g. sold in >= 3 of the last 4 quarters)
//   as its own field. Do not reintroduce it disguised as an age rule.
const MATURITY_DAYS = 180;

// Days from FIRST SALE over which the contender score is measured.
const CONTENDER_WINDOW = 30;

// The FLAT band for the year-on-year direction arrow, as a percentage either side. FLAT IS A BAND, NOT EQUALITY — without it every
// style carrying ordinary noise reads as a trend, and an arrow on all 79 rows is no signal at all.
const DIRECTION_FLAT_PCT = 15;

// A style needs two full years on sale before "last year" means anything. Below that the direction is NEW and the prior figure is
// null, rather than a fake 0 that would render as infinite growth.
const PRIOR_YEAR_MIN_DAYS = 730;

// The fitted conversion model, measured 2026-09-22 across 212 mature styles (first sale 2023-09 to 2026-03), scoring profit in the
// first 30 days against whether the style cleared the bar in its first 180:
//     <= £0  ->   0% (n=10)      £50-99   -> 28% (n=43)      £200+ -> 100% (n=3)
//     £1-49  ->   8% (n=138)     £100-199 -> 72% (n=18)
// Units predict too, but far less sharply (11+ units in 30d gives 52%) — profit is the better signal and swapping back would blunt
// the screen. RECALIBRATE ANNUALLY as cohorts mature; it is a five-minute query (spec section 8.2).
// `min` is an inclusive floor; the null floor catches zero and negative. ORDER MATTERS — first match wins, so keep it high to low.
const BANDS = [
  { name: 'STRONG',   min: 200,  conversion: 100 },
  { name: 'LIKELY',   min: 100,  conversion: 72  },
  { name: 'POSSIBLE', min: 50,   conversion: 28  },
  { name: 'WEAK',     min: 1,    conversion: 8   },
  { name: 'DEAD',     min: null, conversion: 0   },
];

// The bands that carry an action (reorder now, get it into the ad feed). Everything below is deliberately actionless: a trial costs
// about £32 and 8% of the WEAK band still converts, so the action there is "do not reorder" — an absence of a task, not one.
const HIGH_CONFIDENCE_BANDS = ['STRONG', 'LIKELY'];

// Sort rank, strongest first. TOO_EARLY sits at the bottom: it is not a weak signal, it is NO signal yet.
const BAND_RANK = { STRONG: 0, LIKELY: 1, POSSIBLE: 2, WEAK: 3, DEAD: 4, TOO_EARLY: 5 };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// First matching band for a 30-day profit figure. `min: null` always matches, so this never returns undefined.
function bandFor(profit30d) {
  return BANDS.find((b) => b.min === null || profit30d >= b.min);
}

// Current sellable stock per style, as a CTE body. Schema landmine: NEVER skusummary.stockvariants/variants (stale). Local #FREE
// stock plus live FBA stock — the same "what is actually in hand" total the rest of the platform shows.
const STOCK_CTE = `
  SELECT groupid, SUM(qty) AS stock FROM (
    SELECT groupid, SUM(qty) AS qty FROM localstock
    WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
    GROUP BY groupid
    UNION ALL
    SELECT groupid, SUM(COALESCE(amzlive, 0)) AS qty FROM amzfeed
    WHERE COALESCE(amzlive, 0) > 0
    GROUP BY groupid
  ) chan
  GROUP BY groupid
`;

/**
 * The WINNERS side: the list, plus the summary that carries the hero count.
 *
 * One pass over `sales` produces all four figures per style — age, this year's profit and units, last year's profit — with FILTER
 * doing the windowing so the table is scanned once rather than three times (the brand-overview pattern).
 *
 * The prior window is the 12 months BEFORE the current one, [-24m, -12m), so the two never overlap and "joined this year" is exact.
 *
 * @returns {Promise<{summary: object, winners: object[]}>} winners sorted profit_12m descending.
 */
async function computeWinners() {
  const result = await query(
    `
    WITH agg AS (
      SELECT groupid,
             MIN(solddate) AS first_sale,
             COALESCE(SUM(profit)   FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '12 months'), 0) AS profit_12m,
             -- The ::int goes OUTSIDE the COALESCE, not between SUM() and FILTER: a FILTER clause must follow the aggregate call
             -- directly, so SUM(qty)::int FILTER (...) is a parse error. (No backticks in this comment either — the whole query
             -- is a JS template literal and one would end it.)
             COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '12 months'), 0)::int AS units_12m,
             COALESCE(SUM(profit)   FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '24 months'
                                              AND solddate <  CURRENT_DATE - INTERVAL '12 months'), 0) AS profit_prior_12m
      FROM sales
      WHERE qty > 0                      -- returns live in the haircut, not the rows (owner, 2026-09-10)
        AND groupid IS NOT NULL
        AND groupid <> ''
      GROUP BY groupid
    ),
    stk AS (${STOCK_CTE})
    SELECT a.groupid,
           t.shopifytitle                       AS title,
           COALESCE(NULLIF(ss.brand, ''), '')   AS brand,
           to_char(a.first_sale, 'YYYY-MM-DD')  AS first_sale,   -- cast in SQL: never hand a pg DATE to toISOString()
           (CURRENT_DATE - a.first_sale)::int   AS days_on_sale,
           a.profit_12m,
           a.units_12m,
           a.profit_prior_12m,
           COALESCE(st.stock, 0)                AS stock_units
    FROM agg a
    LEFT JOIN skusummary ss ON ss.groupid = a.groupid
    LEFT JOIN title      t  ON t.groupid  = a.groupid
    LEFT JOIN stk        st ON st.groupid = a.groupid
    ORDER BY a.profit_12m DESC, a.groupid
    `
  );

  // Apply the definition. The maturity and bar tests are done here rather than in SQL because the summary needs the LOSING side of
  // them too — a style that cleared the bar last year and not this one is the `left_this_year` count, and by definition it is not
  // in the list.
  //
  // The prior-year test uses the age the style HAD A YEAR AGO, so a style that was 200 days old last September is judged then on
  // the same maturity rule it is judged on now. Without that, every style that merely crossed 180 days during the year would count
  // as having "joined", and joined/left would measure the calendar rather than the trade.
  const winners = [];
  // The denominator for "what share of the range is earning its keep". STYLES THAT SOLD AT ALL IN THE WINDOW — the same table,
  // the same 12 months and the same qty > 0 filter as the numerator, so the two are on identical footing and the percentage
  // cannot be gamed by a definition mismatch. Measured 2026-09-22: 80 of 303 = 26%.
  //
  // Three other denominators were measured and rejected for being no more informative and harder to explain: live Shopify styles
  // (296 -> 27%), every style in skusummary (303 -> 26%), and stocked-or-sold (324 -> 25%). THE ANSWER IS ~26% WHICHEVER IS USED,
  // so this is a labelling choice, not a numerical one — which is exactly why it should be the one that is easiest to say out
  // loud: "of everything that sold this year, a quarter of it earns its keep".
  let totalStyles = 0;
  let winnerCountPriorYear = 0;
  let joined = 0;
  let left = 0;
  let totalProfit12m = 0;

  for (const r of result.rows) {
    const days = Number(r.days_on_sale) || 0;
    const profit12m = num(r.profit_12m) ?? 0;
    const profitPrior = num(r.profit_prior_12m) ?? 0;

    // The whole winner test, both years: did it clear the bar in that window? No age condition on either side — see MATURITY_DAYS.
    // `wasWinnerThen` needs no "was it old enough then" clause for the same reason, and dropping it also removes an artefact the
    // age gate created: styles that merely crossed the age line during the year used to register as having JOINED, which made
    // joined/left partly a measure of the calendar rather than of the trade.
    if ((Number(r.units_12m) || 0) !== 0) totalStyles += 1;

    const isWinnerNow = profit12m > WINNER_PROFIT_BAR;
    const wasWinnerThen = profitPrior > WINNER_PROFIT_BAR;

    if (wasWinnerThen) winnerCountPriorYear += 1;
    if (isWinnerNow && !wasWinnerThen) joined += 1;
    if (!isWinnerNow && wasWinnerThen) left += 1;
    if (!isWinnerNow) continue;

    totalProfit12m += profit12m;

    // Direction. A style without a real prior year is NEW, not a 100% riser — see PRIOR_YEAR_MIN_DAYS.
    let direction;
    let priorOut;
    if (days < PRIOR_YEAR_MIN_DAYS) {
      direction = 'NEW';
      priorOut = null;
    } else {
      priorOut = profitPrior;
      // Guard the divide: a winner whose prior year was zero (or negative) has no ratio to take. It earned nothing then and more
      // than the bar now, which is unambiguously GROWING.
      if (profitPrior <= 0) {
        direction = 'GROWING';
      } else {
        const changePct = ((profit12m - profitPrior) / profitPrior) * 100;
        if (changePct > DIRECTION_FLAT_PCT) direction = 'GROWING';
        else if (changePct < -DIRECTION_FLAT_PCT) direction = 'SHRINKING';
        else direction = 'FLAT';
      }
    }

    winners.push({
      groupid: r.groupid,
      title: r.title || null,          // title.shopifytitle — skusummary.colour is an overloaded segmentation tag, never a name
      brand: r.brand || null,
      profit_12m: Math.round(profit12m * 100) / 100,
      units_12m: Number(r.units_12m) || 0,
      profit_prior_12m: priorOut === null ? null : Math.round(priorOut * 100) / 100,
      direction,
      first_sale: r.first_sale,
      days_on_sale: days,
      stock_units: Number(r.stock_units) || 0,
    });
  }

  return {
    summary: {
      winner_count: winners.length,
      winner_count_prior_year: winnerCountPriorYear,
      joined_this_year: joined,
      left_this_year: left,
      // Styles that traded at all in the window, and the winners' share of them. Rounded to a whole percent: this is a
      // shape-of-the-business figure read at a glance, and a decimal place on it would imply a precision it does not have.
      total_styles: totalStyles,
      winner_share_pct: totalStyles > 0 ? Math.round((winners.length / totalStyles) * 100) : null,
      // Kept in the payload but NOT shown on the Winners screen — the owner's call, 2026-09-22: "I'm not sure I care about
      // values. It is the amount before adverts? I don't care." It stays because it is already stored in every snapshot row.
      total_profit_12m: Math.round(totalProfit12m * 100) / 100,
    },
    winners,
  };
}

/**
 * The CONTENDERS side: young styles scored on their first CONTENDER_WINDOW days, banded.
 *
 * `win30` joins back to sales for the young styles only and sums the window from each style's OWN first sale — the window is
 * per-style, which is why it cannot be a date literal in a WHERE clause. It runs [first_sale, first_sale + 30), i.e. 30 calendar
 * days INCLUDING day one.
 *
 * @returns {Promise<{summary: object, contenders: object[]}>} sorted reorder-queue first, then band, then score.
 */
async function computeContenders() {
  const result = await query(
    `
    WITH born AS (
      SELECT groupid,
             MIN(solddate)              AS first_sale,
             COALESCE(SUM(profit), 0)   AS profit_so_far,
             COALESCE(SUM(qty)::int, 0) AS units_so_far
      FROM sales
      WHERE qty > 0
        AND groupid IS NOT NULL
        AND groupid <> ''
      GROUP BY groupid
    ),
    young AS (
      SELECT * FROM born
      WHERE (CURRENT_DATE - first_sale)::int < $1::int
    ),
    win30 AS (
      SELECT y.groupid,
             COALESCE(SUM(s.profit), 0)   AS profit_first_30d,
             COALESCE(SUM(s.qty)::int, 0) AS units_first_30d
      FROM young y
      JOIN sales s
        ON s.groupid = y.groupid
       AND s.qty > 0
       AND s.solddate >= y.first_sale
       AND s.solddate <  y.first_sale + $2::int
      GROUP BY y.groupid
    ),
    stk AS (${STOCK_CTE})
    SELECT y.groupid,
           t.shopifytitle                       AS title,
           COALESCE(NULLIF(ss.brand, ''), '')   AS brand,
           to_char(y.first_sale, 'YYYY-MM-DD')  AS first_sale,
           (CURRENT_DATE - y.first_sale)::int   AS days_on_sale,
           COALESCE(w.profit_first_30d, 0)      AS profit_first_30d,
           y.profit_so_far,
           y.units_so_far,
           COALESCE(st.stock, 0)                AS stock_units
    FROM young y
    LEFT JOIN win30      w  ON w.groupid  = y.groupid
    LEFT JOIN skusummary ss ON ss.groupid = y.groupid
    LEFT JOIN title      t  ON t.groupid  = y.groupid
    LEFT JOIN stk        st ON st.groupid = y.groupid
    `,
    [MATURITY_DAYS, CONTENDER_WINDOW]
  );

  let expectedWinners = 0;
  let highConfidenceCount = 0;
  let highConfidenceOos = 0;
  // Count per band, so the screen can show the pipeline as a few NUMBERS without pulling the rows apart itself. The Winners screen
  // is a progress check, not a work queue (owner, 2026-09-22 — "Contenders is too long with too much data. I'm not here to act on
  // it, I'm here to check progress"), so the summary has to be able to stand alone.
  const bandCounts = { STRONG: 0, LIKELY: 0, POSSIBLE: 0, WEAK: 0, DEAD: 0, TOO_EARLY: 0 };

  const contenders = result.rows.map((r) => {
    const days = Number(r.days_on_sale) || 0;
    const stock = Number(r.stock_units) || 0;

    // The censoring test. AGE, not sales volume: a style 12 days old has not had its window, however well it has started. Scoring
    // a censored cohort is precisely the mistake that produced a fictitious hit-rate collapse during the analysis session, so this
    // must never be "fixed" by pro-rating a partial window.
    const tooEarly = days < CONTENDER_WINDOW;
    const profit30d = tooEarly ? null : Math.round((num(r.profit_first_30d) ?? 0) * 100) / 100;

    const band = tooEarly ? { name: 'TOO_EARLY', conversion: null } : bandFor(profit30d);

    bandCounts[band.name] += 1;
    if (!tooEarly) {
      // The model's own arithmetic: how many of these the fitted rates say will convert. Summed as a fraction and rounded ONCE at
      // the end, so 13 rows at 72% contribute 9.36 rather than 13 separate roundings.
      expectedWinners += band.conversion / 100;
      if (HIGH_CONFIDENCE_BANDS.includes(band.name)) {
        highConfidenceCount += 1;
        // Out of stock AND high-confidence. Not a queue — it is the one fact that says whether the expected_winners number can
        // actually arrive, so the screen states it in a clause and leaves it there.
        if (stock <= 0) highConfidenceOos += 1;
      }
    }

    return {
      groupid: r.groupid,
      title: r.title || null,
      brand: r.brand || null,
      first_sale: r.first_sale,
      days_on_sale: days,
      profit_first_30d: profit30d,
      band: band.name,
      conversion_pct: band.conversion,
      profit_so_far: Math.round((num(r.profit_so_far) ?? 0) * 100) / 100,
      units_so_far: Number(r.units_so_far) || 0,
      stock_units: stock,
      out_of_stock: stock <= 0,
    };
  });

  // Sort: the reorder queue first (out of stock AND high-confidence — where the stock fact IS the action), then band, then score.
  contenders.sort((a, b) => {
    const aUrgent = a.out_of_stock && HIGH_CONFIDENCE_BANDS.includes(a.band) ? 0 : 1;
    const bUrgent = b.out_of_stock && HIGH_CONFIDENCE_BANDS.includes(b.band) ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;

    const rank = (BAND_RANK[a.band] ?? 99) - (BAND_RANK[b.band] ?? 99);
    if (rank !== 0) return rank;

    // Within a band, biggest score first. TOO_EARLY rows have a null score — fall back to age so the nearly-scorable ones lead.
    if (a.profit_first_30d === null && b.profit_first_30d === null) return b.days_on_sale - a.days_on_sale;
    return (b.profit_first_30d ?? 0) - (a.profit_first_30d ?? 0);
  });

  return {
    summary: {
      young_styles: contenders.length,
      expected_winners: Math.round(expectedWinners),
      high_confidence_count: highConfidenceCount,
      high_confidence_oos: highConfidenceOos,
      band_counts: bandCounts,
    },
    contenders,
  };
}

module.exports = {
  computeWinners,
  computeContenders,
  WINNER_PROFIT_BAR,
  MATURITY_DAYS,
  CONTENDER_WINDOW,
  HIGH_CONFIDENCE_BANDS,
  BANDS,
};
