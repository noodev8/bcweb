/*
=======================================================================================================================================
Module: utils/portfolio.js
=======================================================================================================================================
Purpose: The winner BAR, in one place:

           WINNER_BAR         — utils/portfolioStatus.js, the rule that tags a style WINNERS
           WINNER_BAR_LADDER  — the Winners screen's dial (routes/portfolio-status.js) and the status lists' ?bar=
                                (routes/pricing-status-list.js, routes/amz-status-list.js)

         ⚠ WHAT USED TO LIVE HERE (removed 2026-09-25, git history has it): computeWinners() — a live winner count including deleted
           styles, the profit ladder and band-movement report, behind GET /portfolio-winners and the portfolio_snapshot trend — and
           computeContenders() — young styles scored on first-30-day revenue against a fitted model, behind GET /portfolio-contenders.
           The Winners screen moved to the STORED tag (skusummary.portfolio_status) on 2026-09-24 and no screen read either any
           more; a second live count also meant two screens could show two different "winners" numbers. One ruler now — the tag.

THE DEFINITION (THE CODE IS THE SPEC):
  - WINNER = REVENUE NET OF RETURNS > WINNER_BAR in the rolling 12 months, all channels (net since 2026-09-26 — the rule and the
    reasoning are in utils/portfolioStatus.js, rule 1). No age test (see WINNER_BAR). The metric was PROFIT
    until 2026-09-22; the argument for the change is on WINNER_BAR — do not quietly put profit back.
  - REVENUE is SUM(soldprice * qty) — soldprice is PER UNIT. (sales.profit, by contrast, is already a line total: no qty multiplier.)
=======================================================================================================================================
*/

// GROSS REVENUE (GBP) in the rolling 12 months that makes a style a winner. THIS BAR, OVER THAT WINDOW, IS THE WHOLE TEST — there
// is no age condition.
//
// NO AGE TEST, and putting one back would be a regression, not a tightening. The original spec said "age >= 180 days AND over the
// bar", but its own headline figures were measured without the age test. The owner settled it on 2026-09-22 in favour of the window:
//
//   "Isn't a winner something that earns over the 12m window through all the seasons? My job is to find as many as possible
//    to increase annual revenue."
//
// The bar is already annual: a style that clears it in 132 days is running at ~3x the pace of one that took the full year, so an
// age gate excludes the STRONGEST new assets while counting weaker old ones, and hides a March launch from the count until the
// following March. Measured on the day: the gate hid 15 styles (80 winners without it, 65 with). An age gate also does not measure
// seasonal breadth — if that test is ever wanted, build it explicitly (e.g. sold in >= 3 of the last 4 quarters) as its own field.
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
// WHERE £1,500 CAME FROM: the 80 winners under the old £200 profit bar turned over £367,545 on £52,130 of contribution, a ratio of
// about 7.05x, which puts £200 of contribution at roughly £1,410 of revenue. Rounded to £1,500 — the ladder exists to be read as a
// spread, not to reproduce the old counts exactly, and a round number reads better in the sentence on screen.
//
// ⚠ This bar sets the stored WINNERS tag (utils/portfolioStatus.js) — moving it re-draws who is a winner at the next Update.
const WINNER_BAR = 1500;

// THE SAME TEST, READ AT HIGHER BARS. Not a second definition — one ruler with extra marks on it. The screen offers these as a
// TOGGLE so the owner can ask "and if a winner had to turn over £5,000?" without anyone editing a constant, which is the only safe
// way to answer that question: the bar above sets the stored tag (see its warning) and must not move to satisfy curiosity.
//
// ⚠ THE FIRST ENTRY MUST BE WINNER_BAR. The dial filters WITHIN the tagged WINNERS, so bars[0] is the tag's own bar and shows
//   exactly the tag count (routes/portfolio-status.js, pricing-status-list.js, amz-status-list.js).
//
// Why these four: 1500 is the tracked bar, and 2500/5000/10000 are the round marks above it. They are NOT the 7.05x conversions of
// the old 300/500/1000 (which would be 2115/3525/7050) — the ladder is for reading the shape of the range at a glance, and round
// amounts do that better than amounts that carry the fingerprint of a bar we no longer use. The owner chose the shape directly.
const WINNER_BAR_LADDER = [WINNER_BAR, 2500, 5000, 10000];

module.exports = {
  WINNER_BAR,
  WINNER_BAR_LADDER,
};
