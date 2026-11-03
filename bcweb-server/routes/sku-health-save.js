/*
=======================================================================================================================================
API Route: sku_health_save
=======================================================================================================================================
Method: POST
Purpose: The Save snapshot button on /sku-health. Works out the three SKU health counts (same rules as sku-health-overview.js) and
         writes THIS WEEK's row (keyed on the London Monday) in sku_health_snapshot (migrations/20261103_sku_health_snapshot.sql).
         One row per week: a second press the same week UPDATEs that row (ON CONFLICT on snapshot_date) and never adds another.
         saved_by is resolved from the token (req.user), never sent by the client.
Body: none.
Success Response:
{ "return_code": "SUCCESS", "snapshot": { "snapshotDate": "2026-11-03", "sellers90": 700, "inStock": 1043, "notSold12m": 586,
  "savedBy": "Andreas", "updated": false } }
  - updated: true when this week's row already existed and was overwritten.
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

router.post('/', async (req, res) => {
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
      ),
      counts AS (
        SELECT
          (SELECT COUNT(*)::int FROM sold90) AS sellers90,
          (SELECT COUNT(DISTINCT code)::int FROM in_stock) AS in_stock,
          (SELECT COUNT(*)::int FROM skumap m WHERE m.code NOT IN (SELECT code FROM sold365)) AS not_sold_12m
      ),
      -- The week's Monday (London): every save in the same week lands on this one row.
      today AS (SELECT date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date AS d)
      INSERT INTO sku_health_snapshot (snapshot_date, sellers90, in_stock, not_sold_12m, saved_by, saved_at)
      SELECT today.d, counts.sellers90, counts.in_stock, counts.not_sold_12m, $1, now()
      FROM today, counts
      ON CONFLICT (snapshot_date) DO UPDATE SET
        sellers90 = EXCLUDED.sellers90,
        in_stock = EXCLUDED.in_stock,
        not_sold_12m = EXCLUDED.not_sold_12m,
        saved_by = EXCLUDED.saved_by,
        saved_at = EXCLUDED.saved_at
      RETURNING snapshot_date::text AS snapshot_date, sellers90, in_stock, not_sold_12m, saved_by,
                (xmax <> 0) AS updated
    `, [req.user.display_name || null]);

    const r = rows[0];
    return res.json({
      return_code: 'SUCCESS',
      snapshot: {
        snapshotDate: r.snapshot_date,
        sellers90: r.sellers90,
        inStock: r.in_stock,
        notSold12m: r.not_sold_12m,
        savedBy: r.saved_by,
        updated: r.updated === true,
      },
    });
  } catch (err) {
    logger.error('[sku-health-save] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not save the SKU health snapshot' });
  }
});

module.exports = router;
