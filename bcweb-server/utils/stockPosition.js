/*
=======================================================================================================================================
Util: stockPosition — the Analytics "Stock Position" gauge (living-catalogue count, per channel).
=======================================================================================================================================
Purpose: Compute the CURRENT stock-position snapshot for both sales channels, self-contained for the bcweb Analytics module. The idea:
         count products that are commercially ALIVE right now — not the raw catalogue (which drags along years of dead rows), and not
         only what's in stock (a style that sold through but sold recently is still a real product).

         Grain differs by channel, on purpose (a Shopify product and an Amazon product are different things):
           - Shopify: STYLE grain. Universe = skusummary WHERE shopify=1. In stock now = localstock #FREE qty>0 (schema landmine:
                      NEVER skusummary.stockvariants/variants — stale). recent sale = sales channel='SHP', matched by groupid.
           - Amazon:  SKU grain. Universe = every row in amzfeed (FBA-only, rebuilt nightly from Amazon — so membership already means
                      "still a live listing"). In stock now = amzfeed.amzlive > 0 (amzlive is a live FBA stock QTY, not a flag).
                      recent sale = sales channel='AMZ', matched by code.

         Each product lands in exactly ONE of four buckets (they sum to the channel's universe); "recently" = the SALES_WINDOW below:
           in_stock_selling  — in stock now AND sold recently
           in_stock_no_sale  — in stock now, no recent sale
           oos_sold_recently — out of stock but sold recently
           dormant           — no stock AND no recent sale  (NOT alive; the "gone quiet" pile to triage later)
         ALIVE = in_stock_selling + in_stock_no_sale + oos_sold_recently = total - dormant.

         The recency window is the shared SALES_WINDOW constant (currently 12 months). Two DB round-trips (one per channel), no N+1.
=======================================================================================================================================
*/

const { query } = require('../database');

// How far back a sale still counts a product as "selling / active" (and, inverted, the dormancy gate). Owner chose 12 months
// (≈ a full seasonal cycle for Birkenstock) over the original 6. Single source of truth — the drill route imports this too, so the
// counts and the drilled lists always agree. Internal constant, never user input, so it's safe to interpolate into the SQL.
const SALES_WINDOW = '12 months';

// Shopify (style grain). One row of counts.
async function computeShopify() {
  const result = await query(
    `
    WITH stk AS (
      -- current sellable stock per style (FREE rows only; a sold-out size simply has no row)
      SELECT groupid, SUM(qty) AS q
      FROM localstock
      WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
      GROUP BY groupid
    ),
    sold AS (
      -- styles with at least one Shopify sale within the SALES_WINDOW
      SELECT DISTINCT groupid
      FROM sales
      WHERE channel = 'SHP' AND solddate >= CURRENT_DATE - INTERVAL '${SALES_WINDOW}'
    )
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(stk.q,0) > 0 AND sold.groupid IS NOT NULL)::int AS in_stock_selling,
      COUNT(*) FILTER (WHERE COALESCE(stk.q,0) > 0 AND sold.groupid IS NULL)::int     AS in_stock_no_sale,
      COUNT(*) FILTER (WHERE COALESCE(stk.q,0) = 0 AND sold.groupid IS NOT NULL)::int AS oos_sold_recently,
      COUNT(*) FILTER (WHERE COALESCE(stk.q,0) = 0 AND sold.groupid IS NULL)::int     AS dormant,
      COUNT(*)::int AS total
    FROM skusummary s
    LEFT JOIN stk  ON stk.groupid  = s.groupid
    LEFT JOIN sold ON sold.groupid = s.groupid
    WHERE s.shopify = 1
    `
  );
  return result.rows[0];
}

// Amazon (SKU grain). One row of counts.
async function computeAmazon() {
  const result = await query(
    `
    WITH sold AS (
      -- SKUs with at least one Amazon sale within the SALES_WINDOW
      SELECT DISTINCT code
      FROM sales
      WHERE channel = 'AMZ' AND solddate >= CURRENT_DATE - INTERVAL '${SALES_WINDOW}'
    )
    SELECT
      COUNT(*) FILTER (WHERE COALESCE(f.amzlive,0) > 0 AND sold.code IS NOT NULL)::int AS in_stock_selling,
      COUNT(*) FILTER (WHERE COALESCE(f.amzlive,0) > 0 AND sold.code IS NULL)::int     AS in_stock_no_sale,
      COUNT(*) FILTER (WHERE COALESCE(f.amzlive,0) = 0 AND sold.code IS NOT NULL)::int AS oos_sold_recently,
      COUNT(*) FILTER (WHERE COALESCE(f.amzlive,0) = 0 AND sold.code IS NULL)::int     AS dormant,
      COUNT(*)::int AS total
    FROM amzfeed f
    LEFT JOIN sold ON sold.code = f.code
    `
  );
  return result.rows[0];
}

// Compute both channels. Returns { shp: {...counts}, amz: {...counts} } — each with the four buckets + total.
async function computeStockPosition() {
  const [shp, amz] = await Promise.all([computeShopify(), computeAmazon()]);
  return { shp, amz };
}

module.exports = { computeStockPosition, computeShopify, computeAmazon, SALES_WINDOW };
