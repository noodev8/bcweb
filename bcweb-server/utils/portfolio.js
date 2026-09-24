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
  - WINNER = GROSS REVENUE > WINNER_BAR in the rolling 12 months. THERE IS NO AGE TEST — see the constant's comment for why the
    one the spec originally carried was removed (owner, 2026-09-22). The metric was PROFIT until 2026-09-22; the argument for the
    change is on WINNER_BAR and it is the screen's whole purpose, not a tuning choice — do not quietly put profit back.
  - CONTENDER SCORE = GROSS REVENUE in the style's first CONTENDER_WINDOW days on sale, banded against a FITTED model (see BANDS),
    predicting whether the style clears WINNER_BAR inside its first 365 days. Same metric as the winner test, on purpose.
  - ALL CHANNELS count (Amazon lines are not filtered out — the style is one asset), there is NO `shopify = 1` test (eligibility is
    "did it sell", not "is it still switched on"), and returns are excluded by qty > 0 rather than netted.
  - THE TWO MONEY COLUMNS MULTIPLY DIFFERENTLY, and getting it wrong is silent: REVENUE is SUM(soldprice * qty) because soldprice
    is PER UNIT, while PROFIT is SUM(sales.profit) with NO qty multiplier because it is already a line total. Verified against the
    live table 2026-09-22 (10,178 rows in the window, qty = 1 on 10,141 of them, so the two only diverge on ~0.4% of rows — which
    is exactly why a mistake here would never show up in a spot check).
  - Profit, where it still appears, is CONTRIBUTION — before advertising. The UI must say "earned", not "profit". It is CONTEXT
    on this screen and decides nothing: the bar, the bands and the contender score are all revenue.
=======================================================================================================================================
*/

const { query } = require('../database');

// ---------------------------------------------------------------------------------------------------------------------------------
// The constants. Named here, documented, deliberately NOT query params until someone needs to vary them — the same pattern as the
// pricing WINNERS/LOSERS bars. They live in this file rather than the routes precisely BECAUSE the snapshot writer shares them: a
// bar that differed between the screen and the recorder would silently poison the trend.
// ---------------------------------------------------------------------------------------------------------------------------------

// THE METRIC THE BAR IS READ IN. Stamped onto every snapshot row (portfolio_snapshot.bar_metric) so the trend can never plot two
// different rulers on one line — see the migration and the warning below.
const WINNER_METRIC = 'REVENUE';

// GROSS REVENUE (GBP) in the rolling 12 months that makes a style a winner. THIS BAR, OVER THAT WINDOW, IS THE WHOLE TEST — there
// is no age condition (see MATURITY_DAYS below).
//
// WHY REVENUE AND NOT PROFIT (owner, 2026-09-22, replacing the £200 profit bar this screen shipped with):
//
//   "This is the route PRODUCT FIND > REVENUE > PROFIT > KEEP/DROP. We have to keep loading and building our products with
//    revenue. The rest are for different departments to take care of."
//
// The screen's job is FINDING STYLES WORTH HAVING, and revenue is the honest test for that. `sales.profit` is contribution BEFORE
// ADVERTISING — Google Shopping spend is nowhere in it — so a profit bar was never measuring profit; it was measuring revenue
// with a per-style margin rate applied, and then hiding the ad cost that actually decides whether the style keeps its place. The
// margin question is real but it is the NEXT step in the route, on its own screen: find the revenue, then make it profitable or
// drop it. A bar that mixes the two lets a thin-margin style that sells brilliantly fall out of the count when it is exactly the
// kind of product we want to load and build.
//
// PROFIT DOES NOT LEAVE THE PAYLOAD. Every style still carries profit_12m, and the band report still states what each rung earned
// and its typical earn-per-unit — that is the raw material for the profitability step. Profit is no longer what DEFINES a winner.
//
// WHERE £1,500 CAME FROM: the 80 winners under the old £200 profit bar turned over £367,545 on £52,130 of contribution, a ratio of
// about 7.05x, which puts £200 of contribution at roughly £1,410 of revenue. Rounded to £1,500 — the ladder exists to be read as a
// spread, not to reproduce the old counts exactly, and a round number reads better in the sentence on screen.
//
// ⚠ MOVING THIS BREAKS THE TREND, and so does changing WINNER_METRIC. Snapshots taken since 2026-09-22 stamp both onto the row, so
//   the trend reader can filter to the ruler in force; rows written before that are PROFIT/200 and are filtered OUT rather than
//   plotted alongside. If this number moves again, it is the same job: stamp it, do not silently edit it.
const WINNER_BAR = 1500;

// THE SAME TEST, READ AT HIGHER BARS. Not a second definition — one ruler with extra marks on it. The screen offers these as a
// TOGGLE so the owner can ask "and if a winner had to turn over £5,000?" without anyone editing a constant, which is the only safe
// way to answer that question: the bar above is welded to the trend table (see its warning) and must not move to satisfy curiosity.
//
// ⚠ THE FIRST ENTRY MUST BE WINNER_BAR. routes/portfolio-winners.js returns bars[0] spread into `summary`, so the payload's
//   top-level figures stay exactly what they were before the toggle existed and every existing consumer — crucially the snapshot
//   writer — keeps recording the TRACKED bar no matter what the screen is displaying. Reorder this and you silently change what
//   gets stored in portfolio_snapshot.
//
// Why these four: 1500 is the tracked bar, and 2500/5000/10000 are the round marks above it. They are NOT the 7.05x conversions of
// the old 300/500/1000 (which would be 2115/3525/7050) — the ladder is for reading the shape of the range at a glance, and round
// amounts do that better than amounts that carry the fingerprint of a bar we no longer use. The owner chose the shape directly.
const WINNER_BAR_LADDER = [WINNER_BAR, 2500, 5000, 10000];

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

// THE FITTED CONVERSION MODEL — REFITTED ON REVENUE 2026-09-22, the same day the winner bar became a revenue bar.
//
// PREDICTOR: gross revenue in the style's first CONTENDER_WINDOW days on sale.
// OUTCOME:   did it clear WINNER_BAR of gross revenue within its first 365 days?
//
// Measured over 163 styles with at least a full year on sale. Base rate 44%.
//
//     first 30 days       becomes a winner inside a year
//     >= £750   (n=13)  ->  92%
//     >= £300   (n=55)  ->  65%
//     >= £100   (n=60)  ->  28%
//     <  £100   (n=35)  ->  17%
//
// THE OUTCOME WINDOW MOVED FROM 180 TO 365 DAYS, and that is not a detail. The old model asked "did it clear £200 PROFIT in its
// first 180 days" — a six-month proxy for a twelve-month test, carried over from the spec. Now that the bar is plainly "£1,500 in
// 12 months", the outcome can simply BE the bar, measured over the window the bar names, so the model no longer predicts a proxy
// for the thing we care about; it predicts the thing itself. It also fits better: on the 180-day outcome the revenue predictor is
// NOT monotonic (the £200-299 bucket converts at 3% against 4% for £100-199, an artefact of a hurdle most styles cannot clear in
// six months), while on the 365-day outcome it rises cleanly 17 -> 28 -> 65 -> 92.
//
// WHY THE EXPECTED-WINNERS FIGURE ROUGHLY DOUBLED (20 under the old model, 38 under this one). Both the metric and the horizon
// changed, and the horizon is most of it: a 44% base rate against 18%. THE FORECAST IS SANITY-CHECKED AGAINST REALITY — 33 styles
// actually joined the winner list this year, so a model predicting 38 from the current 99 young styles is in the right place. The
// old model's 20 was answering "how many clear a profit bar within six months", which nothing on this screen asks.
//
// THERE IS NO 'DEAD' BAND ANY MORE. It meant "lost money in its first 30 days" and was reachable only because profit can be
// negative. A style's FIRST SALE is by definition inside its own 30-day window, and returns are excluded by qty > 0 rather than
// netted, so revenue in that window is ALWAYS > 0 — the band could never fire again. Confirmed in the data: zero styles in the
// £0 bucket across all 212 mature styles. WEAK is now the catch-all (min: null), so bandFor() still cannot return undefined.
//
// RECALIBRATE ANNUALLY as cohorts mature; it is a five-minute query (bucket revenue in [first_sale, +30d) against revenue in
// [first_sale, +365d) > WINNER_BAR, over styles at least 365 days old).
//
// `min` is an inclusive floor. ORDER MATTERS — first match wins, so keep it high to low.
const BANDS = [
  { name: 'STRONG',   min: 750,  conversion: 92 },
  { name: 'LIKELY',   min: 300,  conversion: 65 },
  { name: 'POSSIBLE', min: 100,  conversion: 28 },
  { name: 'WEAK',     min: null, conversion: 17 },
];

// The bands that carry an action (reorder now, get it into the ad feed). THE LINE IS "MORE LIKELY THAN NOT": STRONG and LIKELY
// both convert well above half, POSSIBLE at 28% does not. Everything below the line is deliberately actionless — a trial costs
// about £32 and 17% of even the WEAK band still gets there, so the action is "do not reorder", an absence of a task rather than
// one. (Under the profit model this line sat at 72%/28%, which was the same "well above half vs well below" judgement.)
const HIGH_CONFIDENCE_BANDS = ['STRONG', 'LIKELY'];

// Sort rank, strongest first. TOO_EARLY sits at the bottom: it is not a weak signal, it is NO signal yet.
const BAND_RANK = { STRONG: 0, LIKELY: 1, POSSIBLE: 2, WEAK: 3, TOO_EARLY: 4 };

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

// First matching band for a 30-day REVENUE figure. `min: null` always matches, so this never returns undefined.
function bandFor(revenue30d) {
  return BANDS.find((b) => b.min === null || revenue30d >= b.min);
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

// ---------------------------------------------------------------------------------------------------------------------------------
// THE SUMMARY, TAKEN AT ONE BAR. Everything the headline shows, for a single mark on the ladder. Pure arithmetic over the rows the
// one SQL read already returned — no query in here, which is the entire reason a four-bar toggle costs nothing.
//
// `totalStyles` is passed in rather than counted here because the denominator is BAR-INDEPENDENT: "of everything that sold this
// year" does not change when you raise the bar on what counts as earning its keep, and only the numerator should move.
//
// The prior-year figures use the SAME bar as the current year, so "a year ago" on the £500 toggle means "would have been a £500
// winner then", not "was a £200 winner then". Anything else and the comparison is between two different tests.
// ---------------------------------------------------------------------------------------------------------------------------------
function summariseAt(styles, bar, totalStyles) {
  let winnerCount = 0;
  let winnerCountPriorYear = 0;
  let joined = 0;
  let left = 0;
  let totalProfit12m = 0;
  let totalRevenue12m = 0;   // across the WINNERS only, matching every other figure in this summary
  // Units actually shipped by the winners. SUM(qty) with the qty > 0 filter already applied, so returns are EXCLUDED rather
  // than netted off — this is "how many we packed and sent", which is what was asked for.
  let totalUnits12m = 0;
  // Last year's units from THIS year's winners — the like-for-like read. It deliberately does NOT re-run the winner test on last
  // year: the question is "are the products I now rely on shifting more than they did", not "what did last year's set do".
  let totalUnitsPrior12m = 0;
  // Winners per brand, plus what each brand shifted. The hero's supporting detail: which names are actually carrying the count.
  const byBrand = new Map();

  for (const st of styles) {
    // The whole winner test, both years: did it clear the bar in that window? No age condition on either side — see MATURITY_DAYS.
    // `wasWinnerThen` needs no "was it old enough then" clause for the same reason, and dropping it also removes an artefact the
    // age gate created: styles that merely crossed the age line during the year used to register as having JOINED, which made
    // joined/left partly a measure of the calendar rather than of the trade.
    const isWinnerNow = st.revenue12m > bar;
    const wasWinnerThen = st.revenuePrior12m > bar;

    if (wasWinnerThen) winnerCountPriorYear += 1;
    if (isWinnerNow && !wasWinnerThen) joined += 1;
    if (!isWinnerNow && wasWinnerThen) left += 1;
    if (!isWinnerNow) continue;

    winnerCount += 1;
    totalProfit12m += st.profit12m;
    totalRevenue12m += st.revenue12m;
    totalUnits12m += st.units12m;
    totalUnitsPrior12m += st.unitsPrior12m;

    const bAgg = byBrand.get(st.brandKey) || { brand: st.brandKey, winners: 0, units: 0, revenue: 0 };
    bAgg.winners += 1;
    bAgg.units += st.units12m;
    bAgg.revenue += st.revenue12m;
    byBrand.set(st.brandKey, bAgg);
  }

  return {
    // WHICH bar these figures were taken at. On screen it is what the toggle is lit against; in the payload it is what stops a
    // reader having to know that bars[] is in ladder order.
    bar,
    winner_count: winnerCount,
    winner_count_prior_year: winnerCountPriorYear,
    joined_this_year: joined,
    left_this_year: left,
    // The whole range, and the winners' share of it. Rounded to a whole percent: this is a shape-of-the-business figure read at
    // a glance, and a decimal place on it would imply a precision it does not have.
    total_styles: totalStyles,
    winner_share_pct: totalStyles > 0 ? Math.round((winnerCount / totalStyles) * 100) : null,
    // EVERYTHING THAT IS NOT A WINNER — losers, the not-yet-proven, the never-sold, undifferentiated on purpose ("Might be
    // losers, or might be new but I dont care", owner 2026-09-22). This is the nurturing job stated as one number. Derived, not
    // stored: a snapshot keeps winner_count and total_styles, and a third column could only ever disagree with them.
    other_styles: Math.max(0, totalStyles - winnerCount),
    // Kept in the payload but NOT shown on the Winners screen — the owner's call, 2026-09-22: "I'm not sure I care about
    // values. It is the amount before adverts? I don't care." It stays because it is already stored in every snapshot row.
    total_profit_12m: round2(totalProfit12m),
    // Gross revenue the winners brought in over the window. Shown on screen; profit is not (owner: it is before ads and
    // invites a conversation he does not want at a glance). NOT stored in the snapshot — no migration, so it is a live
    // figure only and does not appear on the trend.
    total_revenue_12m: round2(totalRevenue12m),
    total_units_12m: totalUnits12m,
    total_units_prior_12m: totalUnitsPrior12m,
    // Most winners first. Returned WHOLE, not top-N — it is a handful of brands and the screen decides how many to draw.
    by_brand: [...byBrand.values()]
      .map((b) => ({ ...b, revenue: round2(b.revenue) }))
      .sort((a, b) => b.winners - a.winners || b.units - a.units),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE DISTRIBUTION BEHIND THE COUNT — the "report" half of the owner's 2026-09-22 question:
//
//   "I can then decide whether I'm focussing on high volume low profit items and what the sweet spot might be... I shouldn't be
//    focussing on the low 20 items if they only yield another £2 for the year."
//
// A bar toggle answers HOW MANY clear a higher bar. It cannot answer WHAT THE GAP BETWEEN TWO BARS IS WORTH, because a count says
// nothing about the money — and that gap is the actual decision. So the same styles are cut into bands, and each band states what
// it contributed. Read down the `profit` column and the 29 styles between £200 and £300 are worth £6.9k a year between them, while
// the 13 above £1,000 are worth £25.6k: half of everything the winners earn, from a sixth of the winners.
//
// EARNED PER UNIT IS THE COLUMN THAT ANSWERS THE "HIGH VOLUME, LOW PROFIT" HALF — but it MUST be the median of the per-style
// rates, not the band total divided by the band's units, and getting that wrong produced a wrong answer on the day this was
// built. THE MISTAKE, recorded because it is an easy one to make again:
//
//   Band aggregates said £7.79 / £7.43 / £10.16 / £5.72 across the four winner bands, which reads as a SWEET SPOT at £500-£1,000
//   — nearly £3 a unit better than the bands below it. It is not. The lower bands each contain a couple of high-volume thin
//   styles whose units dominate the band's denominator and drag the aggregate down. On the TYPICAL style the same four bands are
//   £10.89 / £10.44 / £12.44 / £4.75: essentially FLAT from £200 to £1,000, with one cliff at the top.
//
//   So `profit_per_unit` (the aggregate) is still returned — it is the honest "what did this rung earn per unit it shipped" —
//   but `profit_per_unit_typical` (the median) is what the screen draws, because the question being asked is "what is a product
//   in this rung LIKE", and that is a question about a typical style, not about a rung's weighted average.
//
// WHAT IS ACTUALLY TRUE, then, and it is a better finding than the one it replaced: there is NO sweet spot to aim at between
// £200 and £1,000 — a winner earns £10-£12 a unit wherever it sits in that range. The only real break is the TOP band, at £4.75.
// And that is not a band, it is a BRAND: the £1,000+ rung is 7 Lunar and 6 Birkenstock, and its three biggest are all St Ives
// colourways at ~£4.50 a unit. It is also 85% AMAZON by units against 29-45% everywhere else, and Amazon's referral fee is what
// thins it — the same price nets roughly twice as much on Shopify (CLAUDE.md). Guarding against the known AMZ understatement
// (sales.profit for AMZ carries a divide-by-1.2 refund haircut that double-counts returns already booked as negative rows, so it
// reads ~20% low): grossing Amazon profit back up by 1.2 still leaves the top rung thinnest. THE CLIFF SURVIVES THE CORRECTION —
// it is a channel-and-brand fact, not a bookkeeping one, and it belongs to the pricing module, not to range planning.
//
// A per-unit rate is a FIXED PROPERTY OF A STYLE, which is why none of this is a target: across the 55 styles shifting 20+ units
// in both years, last year's rate predicts this year's at r = 0.92. You cannot turn a thin style into a fat one by selling more
// of it. You can reprice it or buy something else.
//
// The channel split is deliberately NOT a column in the table. It would answer a question the screen does not exist to ask, on a
// page whose whole design is subtraction, and it invites exactly the "is that really profit" conversation the owner ruled out.
// If it is ever wanted, it is a `sales.channel` FILTER away in the SQL above — but build it as its own view.
//
// BAND EDGES ARE THE LADDER, so the bands always tile the toggle exactly: the count at any mark is the sum of the bands above it
// (29 + 22 + 16 + 13 = 80 at £200), and nothing can drift between the two views. Membership is `> from AND <= to`, matching the
// winner test's strict `>`, with the bottom band open below (it catches the styles that LOST money) and the top band open above.
//
// MEASURED OVER STYLES THAT TRADED IN THE WINDOW, same set as `total_styles`. A style with no sales in the 12 months has a profit
// of exactly 0 and would otherwise pile up in the loss-making band and make it look like a catastrophe.
// ---------------------------------------------------------------------------------------------------------------------------------
// The rungs, low to high: [null, 1500], (1500, 2500], (2500, 5000], (5000, 10000], (10000, null]. Derived from the bar ladder so
// the bands and the toggle can never drift apart, and shared by profitLadder() and bandMovement() so a style cannot be in one
// rung for the table and a different one for the movement count.
//
// THERE IS NO SUB-ZERO RUNG ANY MORE. While the bar was PROFIT, the bottom edge was [null, 0] and it was the loss-making band —
// 37 styles at -£1,198 on 2026-09-22, and a real part of the picture. Gross revenue CANNOT be negative (returns are excluded by
// qty > 0 rather than netted, so the worst a style can do is sell nothing), so that rung became one that can never fire: a band
// reporting 0 styles for ever, inviting the reader to think there are no weak products when there are 229 of them. The bottom
// rung is now simply EVERYTHING BELOW THE BAR, which is the honest shape of the question on a revenue ladder.
//
// ⚠ If the metric ever goes back to something that can be negative, put the [null, 0] edge back — it is not clutter there.
function ladderEdges() {
  const edges = WINNER_BAR_LADDER.map((to, i) => ({ from: i === 0 ? null : WINNER_BAR_LADDER[i - 1], to }));
  edges.push({ from: WINNER_BAR_LADDER[WINNER_BAR_LADDER.length - 1], to: null });
  return edges;
}

// `value` is the BAR'S metric (revenue since 2026-09-22), not profit — the argument was renamed when the bar changed so the two
// can never drift apart again.
const inBandTest = (value, { from, to }) => (from === null || value > from) && (to === null || value <= to);
const bandIndexOf = (value) => ladderEdges().findIndex((e) => inBandTest(value, e));

// Middle value of a sorted-in-place copy. Even-length arrays take the UPPER of the two middles rather than averaging them: the
// figure is a real style's rate either way, which is what "typical" is supposed to mean here.
function median(values) {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

function profitLadder(tradedStyles) {
  const edges = ladderEdges();

  return edges.map(({ from, to }) => {
    // BANDED ON REVENUE, because the bands must tile the bar ladder exactly (see the header) and the ladder is a revenue ladder.
    // The COLUMNS stay profit columns — what each revenue rung actually earns is the input to the profitability step that comes
    // after this screen, and it is the only place on the platform that states it rung by rung.
    const inBand = tradedStyles.filter((st) => inBandTest(st.revenue12m, { from, to }));
    const profit = inBand.reduce((a, st) => a + st.profit12m, 0);
    const revenue = inBand.reduce((a, st) => a + st.revenue12m, 0);
    const units = inBand.reduce((a, st) => a + st.units12m, 0);

    return {
      from,                       // exclusive floor; null = open below (the loss-makers)
      to,                         // inclusive ceiling; null = open above
      // Whether this band is above the TRACKED bar, i.e. whether its styles are winners today. The screen dims the rest — they
      // are context for the decision, not part of the count.
      is_winner_band: from !== null && from >= WINNER_BAR,
      styles: inBand.length,
      profit: round2(profit),
      revenue: round2(revenue),
      units,
      // Per-style and per-unit. Null rather than 0 on an empty band — a rate over nothing is not a rate, and a confident £0.00
      // reads as "these earn nothing" instead of "there are none of these".
      profit_per_style: inBand.length > 0 ? round2(profit / inBand.length) : null,
      // The rung's weighted average — honest, but dominated by its busiest styles. Returned, not drawn. See the header.
      profit_per_unit: units > 0 ? round2(profit / units) : null,
      // WHAT A STYLE IN THIS RUNG IS LIKE. The median of the per-style rates, immune to one 1,500-unit style setting the number
      // for the other 15. THIS is the figure the screen draws — the aggregate above reads as a sweet spot that is not there.
      profit_per_unit_typical: (() => {
        const m = median(inBand.filter((st) => st.units12m > 0).map((st) => st.profit12m / st.units12m));
        return m === null ? null : round2(m);
      })(),
      units_per_style: inBand.length > 0 ? round2(units / inBand.length) : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// IS THE PORTFOLIO COMPOUNDING, OR JUST WIDENING? The count answers neither, and it is the question behind "I want a number I can
// look at to grow" (owner, 2026-09-22).
//
// THE FACT THAT FORCED THIS: big earners are GROWN, NOT FOUND. Measured on the £200 PROFIT ladder this screen used until
// 2026-09-22: of the 13 styles above £1,000, twelve were already above £500 a year ago; and of the 148 styles that first sold in
// the last 12 months, 114 landed at £0-£200, 14 cleared £200 and NONE cleared £1,000. A style climbs the ladder a rung at a time
// over years — so a portfolio can add winners at the bottom every year while the styles it already owns quietly slide, and the
// headline count would not flinch. `up` and `down` are the only figures on this screen that see that. The finding is about the
// SHAPE of the climb and survives the change of ruler, but the counts above are profit-era and should be re-measured on the
// revenue ladder before anyone quotes them again.
//
// (It is also the argument for keeping the TRACKED bar at the BOTTOM of the ladder: that is the only rung a new style can reach
// inside a year, so it is the only bar at which this year's buying decisions show up in this year's number. Tracking at £5,000
// would steer with a two-year lag. See WINNER_BAR.)
//
// MEASURED OVER STYLES THAT TRADED IN BOTH WINDOWS. A style that sold last year and not this one has not "moved down a rung" —
// it has stopped, or been discontinued on purpose, and counting that as a slide would make a deliberate range cull look like
// decay. Same on the other side: a style with no prior year cannot have climbed. Both are the count's business, not this one's.
// ---------------------------------------------------------------------------------------------------------------------------------
function bandMovement(tradedStyles) {
  const both = tradedStyles.filter((st) => st.unitsPrior12m !== 0);

  let up = 0;
  let same = 0;
  let down = 0;
  for (const st of both) {
    const now = bandIndexOf(st.revenue12m);
    const then = bandIndexOf(st.revenuePrior12m);
    if (now > then) up += 1;
    else if (now < then) down += 1;
    else same += 1;
  }

  // The provenance of the top rung, which is what makes "grown, not found" a fact rather than an opinion. ESTABLISHED means the
  // style was already in the rung below (or the top rung itself) a year ago — measured over EVERY style in the top rung, not
  // just the ones that traded twice, so a brand-new arrival at £1,000+ would correctly show as un-established.
  const edges = ladderEdges();
  const topIdx = edges.length - 1;
  const establishedFloor = edges[topIdx - 1].from;   // the floor of the rung below the top one
  const topBand = tradedStyles.filter((st) => bandIndexOf(st.revenue12m) === topIdx);

  return {
    styles: both.length,
    up,
    same,
    down,
    net: up - down,
    top_band_floor: edges[topIdx].from,
    top_band_styles: topBand.length,
    established_floor: establishedFloor,
    top_band_established: topBand.filter((st) => st.revenuePrior12m > establishedFloor).length,
  };
}

/**
 * The WINNERS side: the list, plus the summary that carries the hero count.
 *
 * One pass over `sales` produces all four figures per style — age, this year's profit and units, last year's profit — with FILTER
 * doing the windowing so the table is scanned once rather than three times (the brand-overview pattern).
 *
 * The prior window is the 12 months BEFORE the current one, [-24m, -12m), so the two never overlap and "joined this year" is exact.
 *
 * The summary is measured at EVERY mark on WINNER_BAR_LADDER (see `summary.bars`) and the tracked bar's figures are spread onto
 * `summary` itself, so the payload's top-level shape is unchanged and the snapshot writer keeps recording the tracked bar.
 * `summary.ladder` is the distribution report behind the count — see profitLadder().
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
             -- GROSS revenue: what came in, before cost, fees or ads. soldprice * qty, unlike profit which is already a line total.
             COALESCE(SUM(soldprice * qty) FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '12 months'), 0) AS revenue_12m,
             COALESCE(SUM(profit)   FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '24 months'
                                              AND solddate <  CURRENT_DATE - INTERVAL '12 months'), 0) AS profit_prior_12m,
             -- Prior-year GROSS revenue. This is the one the winner test reads on the "a year ago" side since the bar became a
             -- revenue bar: both sides of the comparison must be measured with the same ruler or joined/left is nonsense.
             COALESCE(SUM(soldprice * qty) FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '24 months'
                                                     AND solddate <  CURRENT_DATE - INTERVAL '12 months'), 0) AS revenue_prior_12m,
             -- Prior-year units, for the "units shifted" comparison. Computed LIVE from sales, exactly like profit_prior_12m —
             -- no snapshot column and no migration is needed for a year-on-year figure, only for putting one on the trend.
             COALESCE(SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - INTERVAL '24 months'
                                         AND solddate <  CURRENT_DATE - INTERVAL '12 months'), 0)::int AS units_prior_12m,
             -- THE BRAND AS THE SALE RECORDED IT, for styles skusummary no longer has. product-delete HARD-deletes the skusummary
             -- row, so a style that traded all winter and was then deleted loses its brand join and lands in "Unbranded" — which
             -- is how L7514-14 (Womens Rieker Fleece Lining Zip Boots Navy, 88 units and £518 earned) came to be its own bucket
             -- on the brand list beside the one remaining Rieker. The sales table carries its own snapshot, which is the whole
             -- reason it survives the delete; the same argument product_event_log is built on. (No backticks in here — the whole
             -- query is a JS template literal and one would end it.)
             --
             -- MOST RECENT non-blank wins — what we last called it. Only 2 groupids in the table ever disagree with themselves
             -- about brand and only 4 of 10,161 rows in the window are blank, so this is a tidy fallback rather than a guess.
             -- The id tie-break makes it deterministic when a style sold twice on its last day.
             (ARRAY_AGG(brand ORDER BY solddate DESC, id DESC)
                FILTER (WHERE COALESCE(TRIM(brand), '') <> ''))[1] AS sales_brand
      FROM sales
      WHERE qty > 0                      -- returns live in the haircut, not the rows (owner, 2026-09-10)
        AND groupid IS NOT NULL
        AND groupid <> ''
      GROUP BY groupid
    ),
    -- THE RANGE. Everything that was part of the business over the window: the catalogue we hold now, PLUS anything that traded
    -- in the last 12 months and has since been deleted. The second half is the owner's call, 2026-09-22:
    --
    --   "A product can come in for a month, do its job and leave. I clean the database but we have success."
    --
    -- So a style that earned £518 over the winter and was then tidied out of skusummary still counts in both the numerator and
    -- the denominator. UNION (not UNION ALL) because the overlap is most of it — 277 of the 329 are in both halves today.
    --
    -- WHAT THIS REPLACED, and why: the denominator used to be "styles that traded in the window", which silently excluded the 26
    -- styles that sold NOTHING. That flatters the share by dropping exactly the products the owner most needs to see — "I want to
    -- see how many Winners there are and how many (others)... What is the gap between winners and our range." The gap IS the
    -- nurturing job, and a denominator that hides the worst of it cannot measure it.
    --
    -- Both definitions happen to give 303 today, which is a coincidence and not a reason to keep the old one: they are DIFFERENT
    -- 303s (277 overlap), and only this one includes a style that has stopped selling.
    range_size AS (
      SELECT
        (SELECT COUNT(*) FROM (
           SELECT groupid FROM skusummary
           UNION
           SELECT groupid FROM sales
            WHERE qty > 0 AND groupid IS NOT NULL AND groupid <> ''
              AND solddate >= CURRENT_DATE - INTERVAL '12 months'
         ) u)::int AS n,

        -- THE RANGE A YEAR AGO, RECONSTRUCTED — and it is the one figure on this screen that is an estimate.
        -- Two things bend it in opposite directions and neither can be fixed retrospectively:
        --   1. Deletions before 2026-09-22 were never recorded, so a style that existed a year ago and has since been tidied
        --      away is invisible here. That UNDERSTATES the old range and overstates the growth.
        --   2. skusummary.created_at is a RECORD date, not a go-live date, so a style stamped two years ago may only have
        --      started trading recently. That OVERSTATES the old range.
        -- Reassurance rather than proof: it lands at 195 against 329 today, a gain of 134 on 131 products added, which is the
        -- consistency you would expect. From 2026-09-22 forward product_event_log records CREATED and DELETED, so this becomes
        -- exact — and portfolio_snapshot.total_styles will carry a true year of history by late 2027. Prefer that when it exists.
        (SELECT COUNT(*) FROM (
           SELECT groupid FROM skusummary WHERE created_at < CURRENT_DATE - INTERVAL '12 months'
           UNION
           SELECT groupid FROM sales
            WHERE qty > 0 AND groupid IS NOT NULL AND groupid <> ''
              AND solddate >= CURRENT_DATE - INTERVAL '24 months'
              AND solddate <  CURRENT_DATE - INTERVAL '12 months'
         ) u)::int AS n_prior,

        -- PRODUCTS MADE: rolling 12 months, the 12 months before it, and this calendar month. ROLLING, NOT year-to-date
        -- (owner, 2026-09-22, after a calendar version was briefly built: "We dont want calendar years. We said, we would use
        -- 12 month rolling?"). A headline meant to drive the work cannot reset to nothing every January, and the two figures
        -- beside it are rolling 12-month windows, so a calendar one would be the odd ruler out. The MONTH stays as the note —
        -- it is the part that answers to this week.
        --
        -- Bucketed on EUROPE/LONDON wall clock, not UTC: the pg session runs Etc/UTC while the box runs BST, so a product made
        -- at 00:30 BST on 1 January would otherwise fall into the previous year (the same trap as CLAUDE.md's date landmines,
        -- and the same treatment routes/analytics-new-additions-trend.js gives its months).
        --
        -- Counted from product_event_log, which keeps the event after the product is deleted. Reports -> New answers the
        -- different question of monthly PACE; see routes/analytics-new-additions-trend.js.
        -- ROLLING 12 MONTHS, not the calendar year: it never resets, and the two figures beside it are rolling windows too.
        (SELECT COUNT(*) FROM product_event_log
          WHERE event = 'CREATED' AND event_at >= CURRENT_DATE - INTERVAL '12 months')::int AS added_ytd,
        (SELECT COUNT(*) FROM product_event_log
          WHERE event = 'CREATED' AND event_at >= CURRENT_DATE - INTERVAL '24 months'
            AND event_at < CURRENT_DATE - INTERVAL '12 months')::int AS added_ytd_prior,
        (SELECT COUNT(*) FROM product_event_log
          WHERE event = 'CREATED'
            AND (event_at AT TIME ZONE 'Europe/London') >= date_trunc('month', now() AT TIME ZONE 'Europe/London'))::int
          AS added_mtd
    ),
    stk AS (${STOCK_CTE})
    SELECT rs.n               AS range_size,
           rs.n_prior         AS range_size_prior,
           rs.added_ytd       AS added_ytd,
           rs.added_ytd_prior AS added_ytd_prior,
           rs.added_mtd       AS added_mtd,
           a.groupid,
           t.shopifytitle                       AS title,
           -- skusummary first (the live catalogue is the authority while the product exists), the sale's own snapshot second.
           COALESCE(NULLIF(TRIM(ss.brand), ''),
                    NULLIF(TRIM(a.sales_brand), ''), '') AS brand,
           to_char(a.first_sale, 'YYYY-MM-DD')  AS first_sale,   -- cast in SQL: never hand a pg DATE to toISOString()
           (CURRENT_DATE - a.first_sale)::int   AS days_on_sale,
           a.profit_12m,
           a.units_12m,
           a.revenue_12m,
           a.profit_prior_12m,
           a.revenue_prior_12m,
           a.units_prior_12m,
           COALESCE(st.stock, 0)                AS stock_units
    FROM agg a
    -- One row, joined to every row: the range size travels with the result rather than costing a second round trip.
    CROSS JOIN range_size rs
    LEFT JOIN skusummary ss ON ss.groupid = a.groupid
    LEFT JOIN title      t  ON t.groupid  = a.groupid
    LEFT JOIN stk        st ON st.groupid = a.groupid
    ORDER BY a.revenue_12m DESC, a.groupid
    `
  );

  // Normalise once, then measure repeatedly. The rows come back ordered by revenue_12m DESC (the bar's metric) and this map
  // preserves that, so the winners list below needs no re-sort.
  //
  // WHY A SEPARATE PASS AT ALL: the summary has to be computed at FOUR bars (WINNER_BAR_LADDER) and the ladder report needs every
  // style banded, so the one thing that must not happen is four SQL round-trips. One read, one normalise, then pure arithmetic.
  const styles = result.rows.map((r) => {
    const days = Number(r.days_on_sale) || 0;
    const profit12m = num(r.profit_12m) ?? 0;
    const profitPrior = num(r.profit_prior_12m) ?? 0;
    const revenue12m = num(r.revenue_12m) ?? 0;
    const revenuePrior = num(r.revenue_prior_12m) ?? 0;

    // Direction. A style without a real prior year is NEW, not a 100% riser — see PRIOR_YEAR_MIN_DAYS.
    let direction;
    let priorOut;
    if (days < PRIOR_YEAR_MIN_DAYS) {
      direction = 'NEW';
      priorOut = null;
    } else {
      priorOut = revenuePrior;
      // Guard the divide: a winner whose prior year was zero has no ratio to take. It turned over nothing then and more than the
      // bar now, which is unambiguously GROWING. Measured on REVENUE, like the bar — an arrow drawn on a different metric from
      // the count beside it is a trap.
      if (revenuePrior <= 0) {
        direction = 'GROWING';
      } else {
        const changePct = ((revenue12m - revenuePrior) / revenuePrior) * 100;
        if (changePct > DIRECTION_FLAT_PCT) direction = 'GROWING';
        else if (changePct < -DIRECTION_FLAT_PCT) direction = 'SHRINKING';
        else direction = 'FLAT';
      }
    }

    return {
      groupid: r.groupid,
      title: r.title || null,          // title.shopifytitle — skusummary.colour is an overloaded segmentation tag, never a name
      // TWO brand fields on purpose. `brand` is the raw value and stays null when the style has none — that is what the list
      // returns and what the UI renders. `brandKey` is the GROUPING key, where a missing brand has to become a real bucket so the
      // by-brand breakdown does not quietly drop those styles. Collapsing the two would make a genuinely blank brand come back
      // out of the list as the literal word "Unbranded".
      brand: r.brand || null,
      brandKey: (r.brand || '').trim() || 'Unbranded',
      profit12m,
      revenue12m,
      revenuePrior12m: revenuePrior,
      units12m: Number(r.units_12m) || 0,
      unitsPrior12m: Number(r.units_prior_12m) || 0,
      profitPrior12m: profitPrior,
      priorOut,
      direction,
      firstSale: r.first_sale,
      days,
      stockUnits: Number(r.stock_units) || 0,
    };
  });

  // THE DENOMINATOR: the whole range, counted in SQL (see the range_size CTE for what is in it and why). Every row carries the
  // same figure, so any row will do; 0 only when there is nothing at all, which is a fresh install.
  //
  // It is BAR-INDEPENDENT, so it is read once here and handed to every bar rather than recounted inside the loop.
  const totalStyles = Number(result.rows[0]?.range_size) || 0;
  // The other two headline figures and their year-ago counterparts. Every row carries the same values (CROSS JOIN), so row 0
  // will do; read here rather than inside summariseAt because none of them depend on the bar.
  const totalStylesPrior = Number(result.rows[0]?.range_size_prior) || 0;
  const addedYtd = Number(result.rows[0]?.added_ytd) || 0;
  const addedYtdPrior = Number(result.rows[0]?.added_ytd_prior) || 0;
  const addedMtd = Number(result.rows[0]?.added_mtd) || 0;

  // The ladder and the movement report keep the narrower "traded in the window" set. A style that sold NOTHING has a profit of
  // exactly 0 and would pile into the loss-making rung, which is a different claim from "it did not sell". They are not drawn on
  // the screen today in any case — see the page header.
  const tradedStyles = styles.filter((s) => s.units12m !== 0);

  // The same summary, taken at each mark on the ladder.
  const bars = WINNER_BAR_LADDER.map((bar) => summariseAt(styles, bar, totalStyles));

  // The list is the TRACKED bar's set, always — the toggle is a reading of the count, not a filter on the rows. The screen does
  // not draw this list at all today (see the page header); it is here for whatever working screen eventually wants it.
  const winners = styles
    .filter((s) => s.revenue12m > WINNER_BAR)
    .map((s) => ({
      groupid: s.groupid,
      title: s.title,
      brand: s.brand,
      profit_12m: round2(s.profit12m),
      revenue_12m: round2(s.revenue12m),
      units_12m: s.units12m,
      profit_prior_12m: round2(s.profitPrior12m),
      // The prior-year figure in the BAR'S metric, and the one `direction` is computed from. Null when the style is younger than
      // PRIOR_YEAR_MIN_DAYS — a style with no real prior year has no comparison, not a zero.
      revenue_prior_12m: s.priorOut === null ? null : round2(s.priorOut),
      direction: s.direction,
      first_sale: s.firstSale,
      days_on_sale: s.days,
      stock_units: s.stockUnits,
    }));

  return {
    summary: {
      // bars[0] IS the tracked bar (WINNER_BAR_LADDER's first entry is WINNER_BAR, enforced by the comment on the
      // constant). Spreading it keeps this payload byte-identical in shape to the pre-toggle version, which is what lets the
      // snapshot writer go on reading summary.winner_count and record the tracked figure whatever the screen is showing.
      ...bars[0],
      // THE OTHER TWO HEADLINES. Bar-independent, so they sit beside the winner figures rather than inside each bar: raising
      // the dial to £500 changes how many styles count as winners, not how many products exist or how many were made.
      // Together the three are the goal (winners), what we hold (range) and the lever (added) — one story at three lags.
      total_styles_prior: totalStylesPrior,   // reconstructed, and the only estimate on this screen — see the CTE
      added_ytd: addedYtd,
      added_ytd_prior: addedYtdPrior,         // the SAME SPAN last year, ending a year ago today
      added_mtd: addedMtd,
      // Every mark on the ladder, so the toggle is instant and cannot disagree with the headline — same read, same arithmetic.
      bars,
      // The distribution behind the count. See profitLadder().
      ladder: profitLadder(tradedStyles),
      // Whether the range already owned is climbing or sliding. Bar-independent — it is a property of the rungs, not of the
      // toggle — so it sits beside the ladder rather than inside each bar. See bandMovement().
      movement: bandMovement(tradedStyles),
    },
    winners,
  };
}

/**
 * The CONTENDERS side: young styles scored on their first CONTENDER_WINDOW days of GROSS REVENUE, banded.
 *
 * SCORED ON REVENUE SINCE 2026-09-22, with the winner bar. The whole screen runs on one metric — "PRODUCT FIND > REVENUE >
 * PROFIT > KEEP/DROP" (owner): this tab is the leading edge of the FIND step, so scoring it on profit would have the pipeline
 * answering a different question from the count it feeds. Profit stays on every row as context, never as the score.
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
             MIN(solddate)                       AS first_sale,
             -- Gross, like the bar: soldprice is PER UNIT (avg £48.87 over the window) so the qty multiplier is required here,
             -- while profit is already a line total and must NOT be multiplied. Verified on 2026-09-22 against 10,178 rows.
             COALESCE(SUM(soldprice * qty), 0)   AS revenue_so_far,
             COALESCE(SUM(profit), 0)            AS profit_so_far,
             COALESCE(SUM(qty)::int, 0)          AS units_so_far
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
             -- THE SCORE. Gross revenue over the style's own first CONTENDER_WINDOW days — see BANDS for the fit behind it.
             COALESCE(SUM(s.soldprice * s.qty), 0) AS revenue_first_30d,
             COALESCE(SUM(s.qty)::int, 0)          AS units_first_30d
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
           COALESCE(w.revenue_first_30d, 0)     AS revenue_first_30d,
           y.revenue_so_far,
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
  const bandCounts = { STRONG: 0, LIKELY: 0, POSSIBLE: 0, WEAK: 0, TOO_EARLY: 0 };

  const contenders = result.rows.map((r) => {
    const days = Number(r.days_on_sale) || 0;
    const stock = Number(r.stock_units) || 0;

    // The censoring test. AGE, not sales volume: a style 12 days old has not had its window, however well it has started. Scoring
    // a censored cohort is precisely the mistake that produced a fictitious hit-rate collapse during the analysis session, so this
    // must never be "fixed" by pro-rating a partial window.
    const tooEarly = days < CONTENDER_WINDOW;
    const revenue30d = tooEarly ? null : round2(num(r.revenue_first_30d) ?? 0);

    const band = tooEarly ? { name: 'TOO_EARLY', conversion: null } : bandFor(revenue30d);

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
      // THE SCORE, and what `band` was decided from. Null while TOO_EARLY — the window has not closed, so there is no score.
      revenue_first_30d: revenue30d,
      band: band.name,
      conversion_pct: band.conversion,
      revenue_so_far: round2(num(r.revenue_so_far) ?? 0),
      // Context only. The winner bar and this score are both revenue; profit belongs to the keep-or-drop step downstream.
      profit_so_far: round2(num(r.profit_so_far) ?? 0),
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
    if (a.revenue_first_30d === null && b.revenue_first_30d === null) return b.days_on_sale - a.days_on_sale;
    return (b.revenue_first_30d ?? 0) - (a.revenue_first_30d ?? 0);
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
  WINNER_METRIC,
  WINNER_BAR,
  WINNER_BAR_LADDER,
  MATURITY_DAYS,
  CONTENDER_WINDOW,
  HIGH_CONFIDENCE_BANDS,
  BANDS,
};
