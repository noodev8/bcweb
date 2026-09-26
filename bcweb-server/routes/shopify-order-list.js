/*
=======================================================================================================================================
API Route: shopify_order_list
=======================================================================================================================================
Method: GET
Purpose: Landing screen for the Shopify Order module — the local-shelf counterpart of Amazon Order (routes/amazon-order-list.js). Every
         Shopify style once, each carrying its FULL size range with what is on the shelf, what is already coming, and what Shopify has
         sold, so the operator can read a style's size curve and add an order for a size. The order itself is written by the existing
         POST /order-status-add with ordertype 2 (local) — this route only reads.

WHY STYLE GRAIN, WITH SIZES NESTED (owner, 2026-09-26 — "see stock from a style perspective, total stock and a breakdown by size").
Amazon Order is a flat SKU list because Amazon prices and stocks per SKU. On Shopify the style is the unit the operator thinks in, and
the decision is "which sizes of this style are running thin", which needs the whole curve side by side. Sizes cannot share fixed
columns across styles the way the Birkenstock sheet's do: non-Birk stock runs in two unrelated size families (UK 03-14, where Skechers
writes 8 / 7.5 rather than 08, and EU 36-46 with halves), so every style ships its own `sizes` array and the page draws its own strip.

SCOPE: skusummary.shopify = 1 (298 of 305 styles on 2026-09-26), every live skumap variant (deleted = 0). BIRKENSTOCK IS INCLUDED,
as an ordinary orderable style (owner, 2026-09-26 — "some may be ordered from stock ... no special case yet"). That is deliberately
unlike Amazon Order, which disables Birkenstock because it never goes to Amazon.

PER SIZE:
  - stock    = sellable shelf stock: localstock WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0 (CLAUDE.md), SUM(qty) — the
               localstock rule; qty is not always 1. EXCLUDES location 'C3-Amazon' and allocated='amz': both are units already
               committed to Amazon (staged for DPD, or flagged by /amz-pick-allocate and waiting to be gathered) and can no longer be sold
               on Shopify. Same predicate as amazon-order-list.js's `loc` CTE, so the two screens can never disagree about the shelf.
  - on_order = un-arrived LOCAL supplier lines (orderstatus, ordertype 2, arrived 0), COUNT(*) — the orderstatus rule, one row per
               unit. TO PLACE and ON ORDER both count: a line confirmed here but not yet placed is still a unit already asked for, and
               leaving it out is how the same size gets ordered twice (the amazon-order-list.js `ord` lesson, owner 2026-08-13).
               Amazon lines (ordertype 3) are NOT counted: they are bought for FBA. Note Goods In books an arriving unit against an
               Amazon line BEFORE a local one (routes/goods-in-book.js), so for a SKU with both kinds open, the local line is the one
               still waiting when the first unit lands.
  - sold_90 / sold_365 = Shopify units sold (sales.channel = 'SHP', qty > 0 — returns don't read as negative sales), last 90 / 365
               days. NOT 30 days: outside Birkenstock, Shopify demand is thin (10 units in 30d, 64 in 90d, 383 in 12m across 123 styles
               on 2026-09-26), so a 30-day per-size figure is almost always 0 and says nothing. 12m is the size curve; 90d says whether
               the style is still moving.
  - supplier = skumap.supplier — what POST /order-status-add validates the line against (verified identical to skusummary.supplier
               on every live Shopify variant, 2026-09-26, but the write checks skumap, so that is what is shipped).

PER STYLE: identity (groupid, title, brand, supplier, season, status), price, cost, and the per-size figures summed. cost =
skusummary.cost via safeNumeric (CLAUDE.md: order cost is ALWAYS skusummary.cost, never skumap.cost) — used by the page to total the
basket's spend.

`to_place` / `on_order` (screen level, beside `styles`) are the local-order backlog: ordertype 2 lines still un-placed, and placed but
not yet arrived. Same shape and same reason as amazon-order-list.js — a queued line that nobody places reads on this screen as stock on
its way. Their own aggregate, not a sum of the per-size figures, so a line whose SKU has since left the list still counts.

NO SERVER-SIDE SEARCH OR LIMIT: ~300 styles / ~2,100 sizes ship in one call and the Include / Exclude steps narrow them in the browser,
exactly like amazon-order-list and inv-styles.

Order QUANTITIES are not a server field — they are the page's browser-side scratchpad until Confirm Basket writes them.

Schema landmines respected: price columns are junk-prone VARCHAR -> safeNumeric. Size = the code's suffix after the last '-', never
RIGHT(code,2) (half sizes and UK sizes). Sizes sort numerically where they are numbers. Human name from title.shopifytitle. Requires auth.
=======================================================================================================================================
Request Query Params: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 298,
  "to_place": { "units": 4, "skus": 3, "suppliers": 1, "oldest_days": 2 },   // local lines queued but not yet placed
  "on_order": { "units": 10, "skus": 6 },                                   // local lines placed with a supplier, not yet arrived
  "styles": [
    { "groupid": "ELZ006-BLACK", "title": "...", "brand": "Lunar", "supplier": "Lunar", "season": "Winter", "status": "STEADY",
      "price": 49.99, "cost": 21.50,
      "stock": 7, "on_order": 2, "sold_90": 3, "sold_365": 18,
      "sizes": [
        { "code": "ELZ006-BLACK-03", "size": "03", "supplier": "Lunar", "stock": 0, "on_order": 0, "sold_90": 0, "sold_365": 1 },
        ...   // every live size, numeric order
      ] },
    ...   // sold_365 desc, then title
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
const { safeNumeric } = require('../utils/sql');
const { notPlaced, placed } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    // One row per live variant, every figure pre-aggregated to code grain in its own CTE and LEFT JOINed, so none of them can fan the
    // row set out and a size with none of a thing reads 0. Styles are assembled from these rows below, in JS, so the per-style totals
    // are by construction the sum of the sizes on screen.
    const result = await query(`
      WITH loc AS (
        -- Sellable shelf stock, less anything committed to Amazon (staged at C3-Amazon, or flagged allocated='amz' and waiting to
        -- be gathered) — see the header. Same predicate as amazon-order-list.js.
        SELECT code, SUM(qty) AS units
        FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted,0) = 0 AND qty > 0 AND location <> 'C3-Amazon'
          AND COALESCE(allocated,'') <> 'amz'
        GROUP BY code
      ),
      ord AS (
        -- Local supplier lines not yet arrived, TO PLACE and ON ORDER alike. One row per unit, so COUNT(*).
        SELECT o.shopifysku AS code, COUNT(*) AS units
        FROM orderstatus o
        WHERE o.arrived = 0 AND o.ordertype = 2
        GROUP BY o.shopifysku
      ),
      sold AS (
        -- Shopify units, gross of returns (qty > 0), over the two windows the page shows. The outer 365-day bound keeps the scan to
        -- the year the wider window needs.
        SELECT code,
               SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 90) AS u90,
               SUM(qty) AS u365
        FROM sales
        WHERE channel = 'SHP' AND qty > 0 AND solddate >= CURRENT_DATE - 365
        GROUP BY code
      )
      SELECT s.groupid,
             t.shopifytitle AS title,
             s.brand, s.supplier AS style_supplier, s.season, s.portfolio_status AS status,
             ${safeNumeric('s.shopifyprice')} AS price,
             ${safeNumeric('s.cost')} AS cost,
             m.code,
             SUBSTRING(m.code FROM '[^-]*$') AS size,
             m.supplier AS supplier,
             COALESCE(loc.units,0) AS stock,
             COALESCE(ord.units,0) AS on_order,
             COALESCE(sold.u90,0) AS sold_90,
             COALESCE(sold.u365,0) AS sold_365
      FROM skusummary s
      JOIN skumap m ON m.groupid = s.groupid AND COALESCE(m.deleted,0) = 0
      LEFT JOIN title t ON t.groupid = s.groupid
      LEFT JOIN loc ON loc.code = m.code
      LEFT JOIN ord ON ord.code = m.code
      LEFT JOIN sold ON sold.code = m.code
      WHERE s.shopify = 1
      ORDER BY s.groupid,
               CASE WHEN SUBSTRING(m.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$'
                    THEN SUBSTRING(m.code FROM '[^-]*$')::numeric END NULLS LAST,
               m.code
    `);

    // Fold the variant rows into styles. The query is ordered by groupid then size, so each style's sizes arrive contiguous and already
    // in curve order; a Map keeps first-seen order until the final sort.
    const byStyle = new Map();
    for (const r of result.rows) {
      let st = byStyle.get(r.groupid);
      if (!st) {
        st = {
          groupid: r.groupid,
          title: r.title || null,
          brand: r.brand || null,
          supplier: r.style_supplier || null,
          season: r.season || null,
          status: r.status || null,
          price: num(r.price),
          cost: num(r.cost),
          stock: 0, on_order: 0, sold_90: 0, sold_365: 0,
          sizes: [],
        };
        byStyle.set(r.groupid, st);
      }
      const size = {
        code: r.code,
        size: r.size,
        supplier: r.supplier || null,
        stock: Number(r.stock) || 0,
        on_order: Number(r.on_order) || 0,
        sold_90: Number(r.sold_90) || 0,
        sold_365: Number(r.sold_365) || 0,
      };
      st.sizes.push(size);
      st.stock += size.stock;
      st.on_order += size.on_order;
      st.sold_90 += size.sold_90;
      st.sold_365 += size.sold_365;
    }

    // Best sellers first — the screen's default reading order, same premise as Amazon Order's "best performers first". Title then
    // groupid as tiebreaks so the ~half of the list that sold nothing in a year still sits in a stable, findable order.
    const styles = [...byStyle.values()].sort((a, b) =>
      (b.sold_365 - a.sold_365)
      || (a.title || '').localeCompare(b.title || '')
      || a.groupid.localeCompare(b.groupid));

    // The local backlog, as its own aggregate over orderstatus — see `to_place` / `on_order` in the header.
    const backlog = await query(`
      SELECT COUNT(*) FILTER (WHERE ${notPlaced()}) AS units,
             COUNT(DISTINCT o.shopifysku) FILTER (WHERE ${notPlaced()}) AS skus,
             COUNT(DISTINCT o.supplier) FILTER (WHERE ${notPlaced()}) AS suppliers,
             MAX(CURRENT_DATE - o.createddate) FILTER (WHERE ${notPlaced()}) AS oldest_days,
             COUNT(*) FILTER (WHERE ${placed()}) AS on_order_units,
             COUNT(DISTINCT o.shopifysku) FILTER (WHERE ${placed()}) AS on_order_skus
      FROM orderstatus o
      WHERE o.arrived = 0 AND o.ordertype = 2
    `);
    const p = backlog.rows[0] || {};
    const toPlace = {
      units: Number(p.units) || 0,
      skus: Number(p.skus) || 0,
      suppliers: Number(p.suppliers) || 0,
      oldest_days: p.oldest_days === null || p.oldest_days === undefined ? null : Number(p.oldest_days),
    };
    const onOrder = { units: Number(p.on_order_units) || 0, skus: Number(p.on_order_skus) || 0 };

    return res.json({ return_code: 'SUCCESS', count: styles.length, to_place: toPlace, on_order: onOrder, styles });
  } catch (err) {
    logger.error('[shopify-order-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Shopify Order list' });
  }
});

module.exports = router;
