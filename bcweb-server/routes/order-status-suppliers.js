/*
=======================================================================================================================================
API Route: order_status_suppliers
=======================================================================================================================================
Method: GET
Purpose: Stage 0 of the Order Status module — the supplier picker, carrying BOTH stages of the order lifecycle so the module home can
         show either without a second call, and can headline "how much is sitting un-ordered" before you click anything.

The lifecycle is Chosen -> Placed -> Arrived (utils/orderStatus.js), and this endpoint splits one aggregate over the middle marker:

  TO PLACE  (orderdate = '')  — chosen in the legacy request screen but NOT yet bought from the supplier. This is a work queue: the
                               goods don't exist yet and nothing is coming until someone actually places the order.
  ON ORDER  (orderdate <> '') — genuinely with the supplier, now a waiting/chasing job.

Both sides require arrived=0 (still open). Splitting them fixes a real inaccuracy: before this, un-placed rows were counted as "waiting",
so a style nobody had ordered yet showed up as an overdue delivery.

`to_place_cost` is the money question — "what will this order cost me" — and comes from `skusummary.cost` via safeNumeric, NOT
`skumap.cost` (blank on ~1200 of 2046 live SKUs and carrying '1000' placeholders on ~370 more, so it would badly understate a total).
Cost is style-level, which is correct for footwear — every size of a style costs the same. `to_place_nocost` counts units whose cost
didn't parse, so the UI can say "est. £412 (+2 unpriced)" rather than silently under-totalling.

Ages come from different clocks by design: a TO PLACE row ages from `createddate` (how long since it was chosen and left un-ordered —
days matter here), an ON ORDER row from the `orderdate` stamp (how long the SUPPLIER has had it — the real chase number). Before this
split both used createddate, which overstated delivery waits by however long the order sat in the queue first.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "suppliers": [
    { "supplier": "Lunar",
      "to_place_units": 3, "to_place_skus": 2, "to_place_styles": 1, "to_place_cost": 47.97, "to_place_nocost": 0,
      "to_place_oldest_days": 0,
      "on_order_batches": 2, "on_order_units": 11, "on_order_oldest_days": 28 },
    ...
  ]  // supplier A-Z; the client sorts per stage (oldest-first) since the two stages want different orders
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
const { placed, notPlaced, placedDate } = require('../utils/orderStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One pass over the open rows, every figure a FILTERed aggregate over the same join — cheaper and always self-consistent versus
    // two queries that could disagree if a row were placed between them.
    // The join to skumap/skusummary is only for cost; a SKU missing from skumap still counts as a unit (LEFT JOIN), it just lands in
    // to_place_nocost. An ON ORDER batch = one (ordertype, placed-date) group, matching how order-status-list.js groups its cards.
    const result = await query(`
      SELECT o.supplier,
             COUNT(*)                    FILTER (WHERE ${notPlaced()}) AS to_place_units,
             COUNT(DISTINCT o.shopifysku) FILTER (WHERE ${notPlaced()}) AS to_place_skus,
             COUNT(DISTINCT sm.groupid)   FILTER (WHERE ${notPlaced()}) AS to_place_styles,
             SUM(${safeNumeric('ss.cost')}) FILTER (WHERE ${notPlaced()}) AS to_place_cost,
             COUNT(*) FILTER (WHERE ${notPlaced()} AND ${safeNumeric('ss.cost')} IS NULL) AS to_place_nocost,
             MAX(CURRENT_DATE - o.createddate) FILTER (WHERE ${notPlaced()}) AS to_place_oldest_days,
             COUNT(DISTINCT (o.ordertype, ${placedDate()})) FILTER (WHERE ${placed()}) AS on_order_batches,
             COUNT(*) FILTER (WHERE ${placed()}) AS on_order_units,
             MAX(CURRENT_DATE - ${placedDate()}) FILTER (WHERE ${placed()}) AS on_order_oldest_days
      FROM orderstatus o
      LEFT JOIN skumap sm     ON sm.code = o.shopifysku
      LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      WHERE o.ordertype IN (2,3) AND COALESCE(o.arrived,0) = 0
      GROUP BY o.supplier
      HAVING COUNT(*) > 0
      ORDER BY o.supplier ASC
    `);

    const suppliers = result.rows.map((r) => ({
      supplier: r.supplier,
      to_place_units: Number(r.to_place_units) || 0,
      to_place_skus: Number(r.to_place_skus) || 0,
      to_place_styles: Number(r.to_place_styles) || 0,
      // NUMERIC comes back as a string from pg; null when every unit's cost was unparseable (or there are no to-place units at all).
      to_place_cost: r.to_place_cost === null ? null : Number(r.to_place_cost),
      to_place_nocost: Number(r.to_place_nocost) || 0,
      to_place_oldest_days: r.to_place_oldest_days === null ? 0 : Number(r.to_place_oldest_days),
      on_order_batches: Number(r.on_order_batches) || 0,
      on_order_units: Number(r.on_order_units) || 0,
      on_order_oldest_days: r.on_order_oldest_days === null ? 0 : Number(r.on_order_oldest_days),
    }));

    return res.json({ return_code: 'SUCCESS', suppliers });
  } catch (err) {
    logger.error('[order-status-suppliers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load suppliers' });
  }
});

module.exports = router;
