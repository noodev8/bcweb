/*
=======================================================================================================================================
Module: utils/shopifyActionable.js
=======================================================================================================================================
Purpose: The derived SHOPIFY clock's counts (docs/segments-spec.md §9.3), per GROUP — how many pricing-ACTIONABLE styles each group
         holds, how many of those still need pricing (un-parked), and when the soonest parked one comes back. Feeds deriveShopify()
         (utils/segmentDerived.js), which turns the counts into a heatmap cell.

Extracted from routes/segments.js on 2026-09-23 when the same cell was needed per Google campaign (routes/pricing-campaigns.js). One
copy, parameterised by the grouping column, so the segment and campaign views can never count differently.

THE CANDIDATE POOL IS WINNERS ∪ LOSERS, NOT "EVERY IN-STOCK STYLE". It is exactly what the two job lists surface, so a cell can always be
driven to zero by working those lists. Without this, "healthy-middle" styles (in stock, un-parked, neither a winner nor a loser)
counted as outstanding yet appeared in no job list — the group could never go green (owner-reported). A style is ACTIONABLE when:
  - WINNER: >= MIN_UNITS Shopify units in 30d AND AVG(profit) >= MIN_PROFIT   (routes/pricing-triage.js)
  - LOSER:  ZERO Shopify units in 30d                                          (routes/pricing-losers.js)
`instock` is therefore the ACTIONABLE count (the denominator the cell shows), not the raw in-stock count. Parking is unaffected by
sales, so a parked-but-actionable style is "done" (drops out of outstanding) until its review lapses. Same stock pool as the lists
(localstock #FREE).

LANDMINE (owner-reported 2026-07-30): these two rules must stay in step with pricing-triage.js / pricing-losers.js. If the WINNERS bar
or the LOSERS window moves there, move it here too — otherwise a style that qualifies for neither list (e.g. exactly 1 unit in 30d)
counts as outstanding here but shows "all done" on the list.
=======================================================================================================================================
*/

const { query } = require('../database');

// The Shopify WINNERS bar, mirrored from routes/pricing-triage.js (MIN_UNITS / MIN_PROFIT) — see the LANDMINE above.
const SHP_MIN_UNITS = 2;    // Shopify units sold in 30d before a style counts as moving
const SHP_MIN_PROFIT = 2;   // £ realised net profit per unit (AVG of sales.profit)

/*
 * shopifyActionableByGroup(groupExpr)
 *   groupExpr: a SQL expression over the skusummary alias `ss` naming the group — ALWAYS one of utils/pricingGroup.js GROUP_COLUMNS,
 *              never request input (it is interpolated).
 * Returns Map<groupName, { instock, outstanding, selling, stuck, nextWake }> — selling + stuck = outstanding, split by which list
 * (Selling = WINNERS, Stuck = LOSERS) each un-parked style sits on. Nothing reads the split since the Top earners cards were removed (2026-09-24). Groups with no actionable in-stock live style are simply absent —
 * deriveShopify() treats a missing entry as zero ('ok').
 */
async function shopifyActionableByGroup(groupExpr) {
  const r = await query(`
    WITH stk AS (
      SELECT groupid, SUM(qty) AS stock FROM localstock
      WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
      GROUP BY groupid
    ),
    s30 AS (   -- 30d Shopify units + realised per-unit margin (same predicates as pricing-triage / pricing-losers)
      SELECT groupid, SUM(qty) AS u30, AVG(profit) AS avg_profit FROM sales
      WHERE channel = 'SHP' AND qty > 0 AND soldprice > 0 AND solddate >= CURRENT_DATE - 30
      GROUP BY groupid
    ),
    cand AS (
      SELECT ${groupExpr} AS name,
             ss.next_shopify_price_review AS review,
             ( COALESCE(s30.u30, 0) >= $1::int
               AND s30.avg_profit >= $2::numeric ) AS winner,   -- NULL avg_profit fails, as in pricing-triage
             COALESCE(s30.u30, 0) = 0 AS loser
      FROM skusummary ss
      JOIN stk ON stk.groupid = ss.groupid          -- INNER JOIN drops 0-stock styles (nothing to price)
      LEFT JOIN s30 ON s30.groupid = ss.groupid
      WHERE ss.shopify = 1                           -- live on Shopify only
    ),
    act AS (
      SELECT name, review, COALESCE(winner, false) AS winner, loser,
             (COALESCE(winner, false) OR loser) AS actionable,
             (review IS NULL OR review <= CURRENT_DATE) AS due
      FROM cand
    )
    SELECT name,
           COUNT(*) FILTER (WHERE actionable)::int AS instock,
           COUNT(*) FILTER (WHERE actionable AND due)::int AS outstanding,
           COUNT(*) FILTER (WHERE winner AND due)::int AS selling,   -- outstanding, split by list (a style is one or the other)
           COUNT(*) FILTER (WHERE loser AND due)::int AS stuck,
           MIN(review) FILTER (WHERE actionable AND review > CURRENT_DATE) AS next_wake
    FROM act
    GROUP BY name
  `, [SHP_MIN_UNITS, SHP_MIN_PROFIT]);

  const byName = new Map();
  for (const row of r.rows) {
    byName.set(row.name, {
      instock: row.instock, outstanding: row.outstanding, selling: row.selling, stuck: row.stuck, nextWake: row.next_wake,
    });
  }
  return byName;
}

module.exports = { shopifyActionableByGroup };
