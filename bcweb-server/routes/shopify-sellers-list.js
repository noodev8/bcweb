/*
=======================================================================================================================================
API Route: shopify_sellers_list
=======================================================================================================================================
Method: GET
Purpose: The SELLERS view of Shopify Order (owner, 2026-10-27 — "check if there is anything on Shopify that is selling and might be missed
         for ordering, especially if not on Amazon"). Amazon Order's flat layout for Shopify: one row per SIZE that sold on Shopify in the
         last 30 days, with just enough to decide — sold 30d / 90d, profit a unit, local stock, local on order, FBA. Read only; the order
         is written by the page's existing basket (POST /order-status-add, ordertype 2), the same one the Sizes view uses.

SCOPE: skusummary.shopify = 1, live skumap sizes (deleted = 0), net Shopify units in 30 days > 0. BIRKENSTOCK IS LEFT OUT (owner,
2026-10-27): it is ordered ~6 months ahead, so a selling Birkenstock size can't be bought in now — it would be most of the list and most
of the Missed count, none of it actionable. The Sizes view (routes/shopify-order-list.js) leaves it out too, since the same day.

PER SIZE:
  - units_30 / units_90 = Shopify units NET of returns (sales.channel = 'SHP', every row summed, so a refund's negative row cancels
               its sale — "100 sold and 90 returned is a mess, not a winner"). Membership is units_30 > 0.
  - unit_profit = AVG(sales.profit) over the size's Shopify sale rows (qty > 0) in 90 days — the realised figure the Selling list's £2
               bar reads; 90 days not 30 because outside Birkenstock most sizes sold once or twice in 30. Null if none.
  - local_stock = sellable shelf, less anything committed to Amazon (C3-Amazon or allocated='amz') — the SAME predicate as
               shopify-order-list.js and amazon-order-list.js, so the three screens can never disagree about the shelf.
  - on_order = un-arrived LOCAL lines (ordertype 2, arrived 0), TO PLACE and ON ORDER both — a queued line is a unit already asked for.
  - on_amazon / fba_live / fba_total = the size's amzfeed row: amzlive, and amztotal (live + inbound) PLUS the Amazon-bound units
               (staged at C3-Amazon, allocated for a pick, un-arrived Amazon lines) — exactly Amazon Order's fba_total, so "at FBA" here
               is the number the Amazon screen shows. The team can pull stock back from FBA, so this is cover too.
  - last_sold = the last Shopify sale date.

DON'T ORDER (owner, 2026-10-27 — "some are duds and I don't want to order anyway"): a SIZE the operator has said they won't re-order
(shopify_dont_order, routes/shopify-dont-order-set.js). `dont_order` is true while the mark stands; it LAPSES the moment the size sells
on Shopify on a day AFTER the day it was marked (London) — a dud that starts selling comes back for another look, with nothing to
remember. A same-day sale doesn't lapse it: that is almost always the very sale that put the size on the list. `dont_order_at` /
`_by` say who and when, for the dimmed row's line.

MISSED (owner, 2026-10-27 — decision A): sold on Shopify in 30 days, NO local stock, NOTHING on local order and NOTHING at / heading to
FBA, and not marked "Can't get it" or "Don't order". Nothing anywhere — act now. A size with FBA stock is NOT missed (it still shows under Low / All
with its FBA figure): counting it would keep the Daily number high on sizes Amazon is selling perfectly well. Decided HERE, once, and
shipped as `missed` per row and `missed_count` — the page's preset and the Daily tile both read it, so they can't disagree.
LOW = local_stock + on_order < units_30 (less than 30 days' cover locally) — a page preset, computed in the browser.

Rows: units_30 desc, then profit, then code. No limit — ~30 rows.
=======================================================================================================================================
Request Query Params: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 29,
  "missed_count": 9,
  "rows": [
    { "code": "L7514-15-38", "groupid": "L7514-15", "size": "38", "title": "...", "brand": "Rieker", "supplier": "Rieker",
      "price": 59.99, "cost": 24.10, "units_30": 2, "units_90": 4, "unit_profit": 12.40,
      "local_stock": 0, "on_order": 0, "on_amazon": true, "fba_live": 3, "fba_total": 3, "last_sold": "2026-10-20",
      "no_supply": false, "no_supply_since": null, "no_supply_until": null, "no_supply_by": null,
      "dont_order": false, "dont_order_at": null, "dont_order_by": null,       // the standing mark only (a lapsed one reads false)
      "missed": false },
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
const { safeNumeric } = require('../utils/sql');
const { noSupplySelectSql, noSupplyFields } = require('../utils/noSupply');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    // Every figure pre-aggregated to code grain in its own CTE and LEFT JOINed, so none can fan the row set out. `sold` is the driver
    // (INNER JOIN): only sizes with a net Shopify sale in 30 days reach the SELECT.
    const result = await query(`
      WITH sold AS (
        SELECT code,
               SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 30) AS u30,
               SUM(qty) AS u90,
               AVG(profit) FILTER (WHERE qty > 0) AS unit_profit,
               MAX(solddate) FILTER (WHERE qty > 0) AS last_sold_d,
               to_char(MAX(solddate) FILTER (WHERE qty > 0), 'YYYY-MM-DD') AS last_sold
        FROM sales
        WHERE channel = 'SHP' AND solddate >= CURRENT_DATE - 90
        GROUP BY code
        HAVING SUM(qty) FILTER (WHERE solddate >= CURRENT_DATE - 30) > 0
      ),
      loc AS (
        -- Sellable shelf, less Amazon-committed units — same predicate as shopify-order-list.js / amazon-order-list.js.
        SELECT code, SUM(qty) AS units
        FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted,0) = 0 AND qty > 0 AND location <> 'C3-Amazon'
          AND COALESCE(allocated,'') <> 'amz'
        GROUP BY code
      ),
      amzbound AS (
        -- Units on their way to FBA: staged at C3-Amazon, or flagged allocated='amz' on a shelf — amazon-order-list.js's staged +
        -- pending, folded into fba_total as it does.
        SELECT code, SUM(qty) AS units
        FROM localstock
        WHERE COALESCE(deleted,0) = 0 AND qty > 0
          AND ((ordernum = '#FREE' AND location = 'C3-Amazon') OR (allocated = 'amz' AND location <> 'C3-Amazon'))
        GROUP BY code
      ),
      ord AS (
        -- Un-arrived supplier lines, one row per unit: local (2) is this screen's on_order, Amazon (3) is FBA on its way.
        SELECT o.shopifysku AS code,
               COUNT(*) FILTER (WHERE o.ordertype = 2) AS local_units,
               COUNT(*) FILTER (WHERE o.ordertype = 3) AS amz_units
        FROM orderstatus o
        WHERE o.arrived = 0 AND o.ordertype IN (2, 3)
        GROUP BY o.shopifysku
      )
      SELECT m.code, s.groupid, SUBSTRING(m.code FROM '[^-]*$') AS size,
             t.shopifytitle AS title, s.brand, m.supplier,
             ${safeNumeric('s.shopifyprice')} AS price,
             ${safeNumeric('s.cost')} AS cost,
             sold.u30 AS units_30, sold.u90 AS units_90, sold.unit_profit, sold.last_sold,
             COALESCE(loc.units,0) AS local_stock,
             COALESCE(ord.local_units,0) AS on_order,
             (a.code IS NOT NULL) AS on_amazon,
             COALESCE(a.amzlive,0) AS fba_live,
             COALESCE(a.amztotal,0) + COALESCE(amzbound.units,0) + COALESCE(ord.amz_units,0) AS fba_total,
             -- Don't order: standing only while no Shopify sale is dated after the London day it was marked (see the header).
             -- last_sold_d is the latest sale in the 90-day window — enough, since any sale after a mark is also the latest.
             (d.code IS NOT NULL AND sold.last_sold_d <= (d.marked_at AT TIME ZONE 'Europe/London')::date) AS dont_order,
             to_char(d.marked_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS dont_order_at,
             d.marked_by AS dont_order_by,
             ${noSupplySelectSql('s')}
      FROM sold
      JOIN skumap m ON m.code = sold.code AND COALESCE(m.deleted,0) = 0
      JOIN skusummary s ON s.groupid = m.groupid
      LEFT JOIN title t ON t.groupid = s.groupid
      LEFT JOIN amzfeed a ON a.code = m.code
      LEFT JOIN loc ON loc.code = m.code
      LEFT JOIN amzbound ON amzbound.code = m.code
      LEFT JOIN ord ON ord.code = m.code
      LEFT JOIN shopify_dont_order d ON d.code = m.code
      WHERE s.shopify = 1 AND COALESCE(s.brand,'') NOT ILIKE 'birk%'
      ORDER BY sold.u30 DESC, sold.unit_profit DESC NULLS LAST, m.code
    `);

    const rows = result.rows.map((r) => {
      const row = {
        code: r.code,
        groupid: r.groupid,
        size: r.size,
        title: r.title || null,
        brand: r.brand || null,
        supplier: r.supplier || null,
        price: num(r.price),
        cost: num(r.cost),
        units_30: Number(r.units_30) || 0,
        units_90: Number(r.units_90) || 0,
        unit_profit: r.unit_profit === null ? null : Math.round(Number(r.unit_profit) * 100) / 100,
        local_stock: Number(r.local_stock) || 0,
        on_order: Number(r.on_order) || 0,
        on_amazon: r.on_amazon === true,
        fba_live: Number(r.fba_live) || 0,
        fba_total: Number(r.fba_total) || 0,
        last_sold: r.last_sold || null,
        ...noSupplyFields(r),
        dont_order: r.dont_order === true,
        dont_order_at: r.dont_order === true ? r.dont_order_at : null,
        dont_order_by: r.dont_order === true ? (r.dont_order_by || null) : null,
      };
      // MISSED — see the header. The one place the rule lives.
      row.missed = !row.no_supply && !row.dont_order && row.local_stock === 0 && row.on_order === 0 && row.fba_total === 0;
      return row;
    });

    return res.json({
      return_code: 'SUCCESS',
      count: rows.length,
      missed_count: rows.filter((r) => r.missed).length,
      rows,
    });
  } catch (err) {
    logger.error('[shopify-sellers-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Shopify sellers' });
  }
});

module.exports = router;
