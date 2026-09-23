/*
=======================================================================================================================================
Module: utils/amazonActionable.js
=======================================================================================================================================
Purpose: The derived AMAZON clock's counts (docs/segments-spec.md §10.3), per GROUP — the SKU-grain twin of utils/shopifyActionable.js.
         How many pricing-ACTIONABLE SKUs each group holds, how many of those still need pricing (un-parked), and when the soonest
         parked one comes back. Feeds deriveShopify() (utils/segmentDerived.js — grain-agnostic despite the name).

Extracted from routes/segments.js on 2026-09-23 when the same cell was needed for Top earners (routes/pricing-top-earners.js). One
copy, parameterised by the grouping column, so the segment and Top-earners views can never count differently.

Candidate pool = FBA-in-stock SKUs (amzfeed.amzlive > 0, the same pool amz-winners / amz-losers draw from); the per-SKU review date
lives on skumap (next_amz_price_review). code is unique in skumap and every in-stock amzfeed SKU has a skumap row, so the join is 1:1
and can't double-count.

Like Shopify, `instock` is the ACTIONABLE count, not the raw in-stock count: it is exactly WINNERS ∪ LOSERS, so the cell can always be
driven to zero by working those two lists.
  - WINNER: >= MIN_UNITS AMZ units in 30d AND AVG(profit) >= MIN_PROFIT   (routes/amz-winners.js)
  - LOSER:  ZERO AMZ units in 30d                                          (routes/amz-losers.js)
HISTORY / WHY THE FILTER EXISTS (owner-reported 2026-07-30): this count used to include EVERY un-parked in-stock SKU, on the
then-correct reasoning that un-parked-in-stock == WINNERS ∪ LOSERS (old WINNER = "sold at least once in 30d", old DEAD = "no sale in
14d" — the dead window nested inside the winner window, leaving no gap; verified on prod 2026-07-12). The 2026-07-29 simplification
broke that: WINNERS gained the two-part >=2 units / >=£2 bar, so a SKU selling 1 unit in 30d (or 2+ on thin margin) is now a winner NO
and a loser NO — it sat in the heatmap denominator but appeared in neither job list, and the segment could never go green (IVES-COLOUR
showed 50/51 with nothing to action).

LANDMINE: these two rules must stay in step with the route files. If the WINNERS bar or the LOSERS window moves there, move it here
too — otherwise the gap silently reopens.
=======================================================================================================================================
*/

const { query } = require('../database');

// The Amazon WINNERS bar, mirrored from routes/amz-winners.js (MIN_UNITS / MIN_PROFIT) — see the LANDMINE above.
const AMZ_MIN_UNITS = 2;    // AMZ units sold in 30d before a SKU counts as moving
const AMZ_MIN_PROFIT = 2;   // £ realised net profit per unit (AVG of sales.profit)

/*
 * amazonActionableByGroup(groupExpr)
 *   groupExpr: a SQL expression over the skusummary alias `sk` naming the group — ALWAYS from utils/pricingGroup.js groupColumn(…,
 *              { alias: 'sk', channel: 'AMZ' }), never request input (it is interpolated).
 * Returns Map<groupName, { instock, outstanding, nextWake }>. Groups with no actionable FBA-in-stock SKU are simply absent —
 * deriveShopify() treats a missing entry as zero ('ok').
 */
async function amazonActionableByGroup(groupExpr) {
  const r = await query(`
    WITH w30 AS (   -- 30d Amazon units + realised per-unit margin, per SKU (same predicates as amz-winners / amz-losers)
      SELECT code, SUM(qty) AS u30, AVG(profit) AS avg_profit
      FROM sales
      WHERE channel = 'AMZ' AND qty > 0 AND soldprice > 0 AND solddate >= CURRENT_DATE - 30
      GROUP BY code
    ),
    cand AS (
      SELECT ${groupExpr} AS name,
             m.next_amz_price_review AS review,
             ( ( COALESCE(w30.u30, 0) >= $1::int
                 AND w30.avg_profit >= $2::numeric )   -- WINNER (NULL avg_profit fails, as in amz-winners)
               OR COALESCE(w30.u30, 0) = 0 ) AS actionable   -- LOSER
      FROM amzfeed a
      JOIN skusummary sk ON sk.groupid = a.groupid
      JOIN skumap m ON m.code = a.code             -- 1:1 (code unique in skumap; every in-stock amzfeed SKU has a skumap row)
      LEFT JOIN w30 ON w30.code = a.code
      WHERE COALESCE(a.amzlive, 0) > 0             -- in FBA stock now (nothing to price on an out-of-stock SKU)
    )
    SELECT name,
           COUNT(*) FILTER (WHERE actionable)::int AS instock,
           COUNT(*) FILTER (WHERE actionable
                              AND (review IS NULL OR review <= CURRENT_DATE))::int AS outstanding,
           MIN(review) FILTER (WHERE actionable AND review > CURRENT_DATE) AS next_wake
    FROM cand
    GROUP BY name
  `, [AMZ_MIN_UNITS, AMZ_MIN_PROFIT]);

  const byName = new Map();
  for (const row of r.rows) {
    byName.set(row.name, { instock: row.instock, outstanding: row.outstanding, nextWake: row.next_wake });
  }
  return byName;
}

module.exports = { amazonActionableByGroup };
