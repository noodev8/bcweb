/*
=======================================================================================================================================
Util: stockSitting
=======================================================================================================================================
Purpose: THE SITTING RULE — stock now, split SELLING | SITTING | NEW, and the sitting styles. Owner, 2026-10-10: "Stock comes in, goes
         out, happy. Sits, not happy so I push it." Defined ONCE here and read by:
           - GET /analytics-stock-sitting  (Reports -> Stock vs Sales: the three boxes and the sitting list)
           - GET /pricing-sitting-list     (Repricing: the same styles as a Shopify list, to clear them)
         so the box, the list on Stock vs Sales and the Repricing list can never disagree about which styles are sitting.

SITTING = a style we hold stock of with NO SALE ON ANY CHANNEL FOR 60 DAYS (or never sold). That single test is the whole rule.
         Deliveries are deliberately ignored (owner, 2026-10-10: "We shouldn't care about delivery. My fault if I'm still ordering
         while they are not selling. Just want to know what hasn't sold."). The first cut gave a fresh delivery its own 60 days; that
         was removed, so a style re-ordered while not selling shows here — which is the point.

         Why 60: the owner looked at 30/60/90 the same day. 30 days put HALF the stock on the list in October (summer stock resting —
         it measures the weather); 90 is too late to act on. 60 is "it has stopped" while there's still time to push.

THIS IS A FACT, NOT A FORECAST. Deliberately unlike the EXCESS rules removed 2026-10-10 (git f0ed513, e4f91fd, dd28eb4), which predicted
         need from past pace and misread seasonal buying (a selling Zermatt read as excess). "No sale in 60 days" has no pace and no
         season in it. Don't grow it into a stock-needs rule without the owner.

NEW PRODUCTS GET THEIR CHANCE (owner, 2026-10-10: "Is NEW factored, to give it a chance?"). A style created in the last 60 days (the
         SAME window as the sale test) that hasn't sold is NEW, not sitting — its own part of the split, and off the list. The PRODUCT's
         age, skusummary.created_at — never a delivery date: a re-order of a non-seller is still sitting (above). After 60 days an
         unsold new style becomes sitting with no action needed. A new style that HAS sold is just selling.
         NOT the portfolio NEW status's 90 days (utils/portfolioStatus.js NEW_DAYS) — first built on it, switched the same day (owner:
         "switch to 60") so every number on the screen reads one window. It differed by one style then. Don't re-point it at NEW_DAYS.

         So stock splits three ways and always adds to 100%: SELLING (sold in 60 days) | SITTING | NEW (unsold, under 60 days old).

STOCK is the utils/financeStock.js definition (local #FREE, not deleted + amzfeed.amztotal), per style, so the total agrees with Month
         End and the nightly stock_daily line. Read LIVE (stock_daily is a total, not per style). Only styles with stock > 0 count.
         Units are local + Amazon as ONE number — the owner doesn't want the split on these lists.

SALES are `sales` rows with qty > 0 on any channel — Shopify, Amazon, the shop (a return is not a sale).

         READ-ONLY.
=======================================================================================================================================
Exports:
  SITTING_DAYS
  loadStockSplit() -> { days, new_days, total_units, selling_units, new_units, sitting_units,
                        styles: [{ groupid, title, brand, units, last_sale, idle_days }] }   // sitting only, most pairs first
=======================================================================================================================================
*/

const { query } = require('../database');

const SITTING_DAYS = 60;   // see header — the owner's pick between 30/60/90; also the NEW age (one window)

// EVERY held style comes back (a few hundred rows), classified, so the three parts and the total come from one read and always add
// up. Dates go out as text (CLAUDE.md: never hand a pg DATE to the JS Date parser).
const SPLIT_SQL = `
  WITH local_free AS (
    SELECT groupid, SUM(qty) AS qty FROM localstock
    WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
    GROUP BY groupid
  ),
  amz AS (
    SELECT groupid, SUM(amztotal) AS qty FROM amzfeed WHERE groupid IS NOT NULL GROUP BY groupid
  ),
  stock AS (
    SELECT g.groupid, COALESCE(lf.qty, 0)::int AS local_units, COALESCE(a.qty, 0)::int AS amz_units
    FROM (SELECT groupid FROM local_free UNION SELECT groupid FROM amz) g
    LEFT JOIN local_free lf ON lf.groupid = g.groupid
    LEFT JOIN amz a         ON a.groupid  = g.groupid
  ),
  held AS (
    SELECT * FROM stock WHERE local_units + amz_units > 0
  ),
  last_sale AS (
    SELECT groupid, MAX(solddate) AS d FROM sales
    WHERE qty > 0 AND groupid IN (SELECT groupid FROM held)
    GROUP BY groupid
  )
  SELECT h.groupid, t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand,
         h.local_units + h.amz_units AS units,
         to_char(s.d, 'YYYY-MM-DD') AS last_sale,
         CURRENT_DATE - s.d AS idle_days,
         (s.d IS NOT NULL AND s.d >= CURRENT_DATE - $1::int) AS selling,
         COALESCE(ss.created_at >= now() - make_interval(days => $1::int), false) AS is_new
  FROM held h
  LEFT JOIN last_sale s   ON s.groupid  = h.groupid
  LEFT JOIN skusummary ss ON ss.groupid = h.groupid
  LEFT JOIN title t       ON t.groupid  = h.groupid
  ORDER BY h.local_units + h.amz_units DESC, h.groupid
`;

/** Stock now split SELLING | SITTING | NEW, plus the sitting styles (most pairs first). Read-only. */
async function loadStockSplit() {
  const r = await query(SPLIT_SQL, [SITTING_DAYS]);

  // Selling wins over NEW: a new style that has sold is simply selling. NEW is only the not-yet-sold new ones.
  let total = 0, selling = 0, newUnits = 0;
  const styles = [];
  for (const x of r.rows) {
    const units = Number(x.units);
    total += units;
    if (x.selling) { selling += units; continue; }
    if (x.is_new) { newUnits += units; continue; }
    styles.push({
      groupid: x.groupid,
      title: x.title || null,
      brand: x.brand || null,
      units,
      last_sale: x.last_sale,
      idle_days: x.idle_days === null ? null : Number(x.idle_days),
    });
  }

  return {
    days: SITTING_DAYS,
    new_days: SITTING_DAYS,
    total_units: total,
    selling_units: selling,
    new_units: newUnits,
    sitting_units: total - selling - newUnits,
    styles,
  };
}

module.exports = { SITTING_DAYS, loadStockSplit };
