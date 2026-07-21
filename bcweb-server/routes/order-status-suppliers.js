/*
=======================================================================================================================================
API Route: order_status_suppliers
=======================================================================================================================================
Method: GET
Purpose: Stage 0 of the Order Status module — "which suppliers currently have an order open". A supplier appears here only while it
         has at least one orderstatus row that is a genuine SUPPLIER order (ordertype 2=local or 3=amazon, per docs/order-status-
         lifecycle.docx) and still WAITING (arrived=0). Customer orders (ordertype 1) and Amazon Picks (never land in orderstatus)
         are out of scope for this screen — see CLAUDE.md "Order Status" module notes.

Why "open" only: an order that has fully arrived is either already gone (Amazon: deleted 7 days after arrival by update_orders2.py) or
about to be (Local: deleted after 30 days by clean_sales.sql regardless of arrival). This picker exists to answer "what am I still
waiting on", so it only surfaces suppliers with something outstanding.

`oldest_days` is the age (in days, from createddate) of that supplier's longest-waiting unit — the same number the list screen uses
to colour-flag a batch (amber >=14d, red >=21d, matching the manual clear-out window before the 30-day auto-purge). Surfacing it here
lets the operator spot a stuck supplier before opening it.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "suppliers": [
    { "supplier": "Rieker", "open_batches": 2, "open_units": 11, "oldest_days": 28 },
    ...
  ]  // ordered oldest-first (most overdue supplier surfaces first)
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
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // A "batch" = one (ordertype, createddate) group for that supplier (see order-status-list.js for why createddate rather than
    // ponumber — the owner may stop using PO numbers, so grouping keys off the day the order was created into orderstatus).
    const result = await query(`
      SELECT supplier,
             COUNT(DISTINCT (ordertype, createddate)) AS open_batches,
             COUNT(*) AS open_units,
             MAX(CURRENT_DATE - createddate) AS oldest_days
      FROM orderstatus
      WHERE ordertype IN (2,3) AND COALESCE(arrived,0) = 0
      GROUP BY supplier
      ORDER BY oldest_days DESC, supplier ASC
    `);

    const suppliers = result.rows.map((r) => ({
      supplier: r.supplier,
      open_batches: Number(r.open_batches),
      open_units: Number(r.open_units),
      oldest_days: r.oldest_days === null ? 0 : Number(r.oldest_days),
    }));

    return res.json({ return_code: 'SUCCESS', suppliers });
  } catch (err) {
    logger.error('[order-status-suppliers] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load suppliers' });
  }
});

module.exports = router;
