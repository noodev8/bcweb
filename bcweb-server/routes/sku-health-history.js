/*
=======================================================================================================================================
API Route: sku_health_history
=======================================================================================================================================
Method: GET
Purpose: The saved SKU health rows for the last 12 months, newest first, for the list under the three boxes on /sku-health.
         Rows come from sku_health_snapshot (migrations/20261103_sku_health_snapshot.sql): one per WEEK (keyed on the Monday), written
         by the Save button, and back-filled for the 52 weeks before the first save. The list is capped at 52 rows (LIMIT 52).
         inStock is null on back-filled days (stock history cannot be rebuilt).
Success Response:
{ "return_code": "SUCCESS", "rows": [ { "date": "2026-11-03", "sellers90": 700, "inStock": 1043, "notSold12m": 586,
  "savedBy": "Andreas" } ] }
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
    const { rows } = await query(`
      SELECT snapshot_date::text AS date, sellers90, in_stock, not_sold_12m, saved_by
      FROM sku_health_snapshot
      ORDER BY snapshot_date DESC
      LIMIT 52
    `);
    return res.json({
      return_code: 'SUCCESS',
      rows: rows.map((r) => ({
        date: r.date,
        sellers90: r.sellers90,
        inStock: r.in_stock,
        notSold12m: r.not_sold_12m,
        savedBy: r.saved_by,
      })),
    });
  } catch (err) {
    logger.error('[sku-health-history] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the SKU health history' });
  }
});

module.exports = router;
