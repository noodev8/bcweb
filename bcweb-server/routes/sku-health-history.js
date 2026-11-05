/*
=======================================================================================================================================
API Route: sku_health_history
=======================================================================================================================================
Method: GET
Purpose: The SKU health figures for each of the last 52 weeks plus this one (one point per MONDAY, London), newest first, for the trend
         lines and weekly table on /sku-health. WORKED OUT LIVE from `sales` and `skumap` every time the screen opens (owner,
         2026-11-05: "Can this just be a snapshot when I look at it" — a Save button nobody presses left gaps). ~0.7s for 53 weeks.
           - sellers90:  SKUs with a sale in the 90 days ending on that Monday (inclusive), any channel.
           - notSold12m: skumap sizes with NO sale in the 365 days ending on that Monday (inclusive). Uses TODAY's size map, so a past
                         week is close, not exact (a size added since counts as "not sold" then).
         In stock is NOT here: stock on hand can't be rebuilt for past dates, so the screen shows it as a live number only.
         The old sku_health_snapshot table (migrations/20261103_sku_health_snapshot.sql) and its Save route are no longer used —
         the table is left in the DB untouched.
         READ ONLY. Requires auth.
Success Response:
{ "return_code": "SUCCESS", "rows": [ { "date": "2026-11-02", "sellers90": 716, "notSold12m": 586 } ] }
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
    // sc = one row per code per sale day, only as far back as the oldest week's 12-month window needs — so the 53 per-week counts scan
    // a small set rather than all of `sales`.
    const { rows } = await query(`
      WITH wk AS (
        SELECT dd::date AS wk
          FROM generate_series(date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date - 52 * 7,
                               date_trunc('week', (now() AT TIME ZONE 'Europe/London'))::date,
                               interval '7 days') AS dd
      ),
      sc AS (
        SELECT DISTINCT code, solddate FROM sales WHERE solddate >= (SELECT MIN(wk) FROM wk) - 364
      )
      SELECT wk::text AS date,
             (SELECT COUNT(DISTINCT code) FROM sc WHERE solddate BETWEEN wk - 89 AND wk)::int AS sellers90,
             (SELECT COUNT(*) FROM skumap m
               WHERE NOT EXISTS (SELECT 1 FROM sc WHERE sc.code = m.code AND sc.solddate BETWEEN wk - 364 AND wk))::int AS not_sold_12m
        FROM wk
       ORDER BY wk DESC
    `);
    return res.json({
      return_code: 'SUCCESS',
      rows: rows.map((r) => ({ date: r.date, sellers90: r.sellers90, notSold12m: r.not_sold_12m })),
    });
  } catch (err) {
    logger.error('[sku-health-history] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the SKU health history' });
  }
});

module.exports = router;
