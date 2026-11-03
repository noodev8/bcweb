/*
=======================================================================================================================================
API Route: sku_health_overview
=======================================================================================================================================
Method: GET
Purpose: Three numbers for the Admin screen "SKU health" (owner, 2026-11-03: "keep it simple, very simple"). Kept out of the Daily hero
         on purpose — staff should not be confused by a fourth block on the dashboard.
           - sellers90:     SKUs (codes) with a sale on ANY channel in the last 90 days — the number to grow.
           - inStock:       SKUs with stock now — sellable local pairs (#FREE, qty > 0) or FBA units (amzfeed amztotal > 0).
           - notSold12m:    SKUs in the size map (skumap) with NO sale on any channel in the last 365 days. Shown to staff as
                            "Not sold in 12 months" — the word "dead" is not used on screen (owner's call).
         Counts only. Rules match the working figures used on 2026-11-03 (586 not sold in 12 months; 1,043 in stock).
         READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "sellers90": 1200,
  "inStock": 1043,
  "notSold12m": 586
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
    const { rows } = await query(`
      WITH sold90 AS (
        SELECT DISTINCT code FROM sales
        WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 90
      ),
      sold365 AS (
        SELECT DISTINCT code FROM sales
        WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 365
      ),
      in_stock AS (
        SELECT code FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        UNION
        SELECT code FROM amzfeed WHERE amztotal > 0
      )
      SELECT
        (SELECT COUNT(*)::int FROM sold90) AS sellers90,
        (SELECT COUNT(DISTINCT code)::int FROM in_stock) AS "inStock",
        (SELECT COUNT(*)::int FROM skumap m
          WHERE m.code NOT IN (SELECT code FROM sold365)) AS "notSold12m"
    `);
    const r = rows[0] || {};
    return res.json({
      return_code: 'SUCCESS',
      sellers90: r.sellers90 ?? 0,
      inStock: r.inStock ?? 0,
      notSold12m: r.notSold12m ?? 0,
    });
  } catch (err) {
    logger.error('[sku-health-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the SKU health counts' });
  }
});

module.exports = router;
