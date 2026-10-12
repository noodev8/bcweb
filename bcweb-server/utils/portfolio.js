/*
=======================================================================================================================================
Module: utils/portfolio.js
=======================================================================================================================================
Purpose: The winner BAR, in one place — and Amazon Order's Hot | Warm bars beside it:

           WINNER_BAR         — utils/portfolioStatus.js, the rule that tags a style WINNERS
           WINNER_BAR_LADDER  — the Winners screen's dial (routes/portfolio-status.js) and the status lists' ?bar=
                                (routes/pricing-status-list.js, routes/amz-status-list.js)
           HOT_SHARE / WARM_MIN_UNIT_PROFIT — Amazon Order's presets (routes/amazon-order-list.js); see the note above them

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

// REVENUE NET OF RETURNS (GBP) in the rolling 12 months that makes a style a winner. THIS BAR, OVER THAT WINDOW, IS THE WHOLE TEST — there
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
// WHY £1,500 — THE TOP 20% OF STYLES (owner, 2026-10-12: "It's that 20% I want to keep feeding"). The bar is the 12-month net revenue
// of the style at the top-20% line, among styles with any net revenue in the window, rounded to the nearest £50. On 2026-10-12 that
// line was £1,530: 64 of 320 selling styles, 70.7% of revenue, 73.6% of profit. The business runs 70/20, not 80/20 — it held at
// 68-71% at every quarterly point back a year, and 80% of revenue takes ~31% of styles (a ~£950 bar). The owner chose the 20% of
// STYLES as the anchor, not the 80% of revenue.
//
// IT IS A FIXED NUMBER, REVIEWED ON REQUEST — never computed live. A winner should change because the owner moved the bar, not
// because the calendar did. The line drifts DOWN as the range grows (£2,060 a year earlier, on 164 selling styles), so it does go
// stale: `node scripts/winner-bar-review.js` prints the current line, its count and share, and who would join or leave. Leave it
// alone inside ~10% (styles near the line would otherwise flip in and out every review); outside that, the owner decides, the
// constant changes here, and "Update now" on the Status tab re-tags. Last review: 2026-10-12, line £1,530 -> kept £1,500.
//
// (History: £1,500 was first set on 2026-09-22 as a conversion of the old £200 profit bar — the 80 winners under it turned over
// ~7.05x their contribution, ~£1,410, rounded up. The 20% reason above came later and happened to land on the same figure.)
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

// ---------------------------------------------------------------------------------------------------------------------------------
// AMAZON ORDER'S HOT | WARM — a 30-day, per-SIZE reading of how a SKU is selling on Amazon right now. NOT a winner definition: a
// WINNER is a style's 12 months ("is it worth having?"), a temperature is a size's last 30 days ("is it moving?"). They sit here so
// every bar the business ranks by is in one file. Read by routes/amazon-order-list.js, which sends both to the page.
//
// HOT = the top HOT_SHARE of the sizes that SOLD in the last 30 days (net units > 0), ranked by 30-day profit (owner, 2026-10-12 —
// "Hot is 20% of the top sellers by profit in 30 days"). Was profit_30d > £30 until then. Profit, not revenue, because this screen
// spends money on stock, and Amazon's thin margin is the question there.
//
// UNLIKE WINNER_BAR, THIS IS COMPUTED LIVE, not a reviewed constant: a 30-day line swings ~2.5x with the season (the top-20% line ran
// £12-£31 across the year to 2026-10-12, and a fixed £30 left Hot with 0-4 sizes through winter — empty exactly when knowing what is
// still moving matters). The 20% is the fixed part; the £ line is a result. Ranking also makes it immune to the known ~20%
// understatement of booked Amazon profit. On the day: 147 sizes sold, 29 Hot at £15.36+, 57.5% of the 30-day profit.
const HOT_SHARE = 0.2;

// WARM = not Hot, last-sale unit profit over this, and an Amazon sale in the last 6 months (the page's guard on the sticky
// unit_profit — see isRecentlySold there). A margin FLOOR, not a ranking, so the 20% idea doesn't apply. Why £3: on 2026-10-12
// the median recently-sold size made £4.52 a unit and £3 cut the bottom third (129 of 356). Owner's original figure (2026-08-07),
// kept with that reason on 2026-10-12.
const WARM_MIN_UNIT_PROFIT = 3;

module.exports = {
  WINNER_BAR,
  WINNER_BAR_LADDER,
  HOT_SHARE,
  WARM_MIN_UNIT_PROFIT,
};
