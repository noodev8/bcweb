/*
=======================================================================================================================================
API Route: analytics_stock_position_update
=======================================================================================================================================
Method: POST
Purpose: Analytics module — Stock Position "Update now" button. Recomputes the current living-catalogue figures for both channels
         (utils/stockPosition.js) and UPSERTs them as TODAY's two rows in stock_position_snapshot (one per channel — latest run of the
         day wins), then prunes any rows older than 2 years. Manual-trigger only (no cron) — the owner clicks Update to record a trend
         point, so merely viewing the page (GET /analytics-stock-position, read-only) never appends a snapshot.

         Growth safeguard (why this is bounded):
           - (snapshot_date, channel) is the PK and we UPSERT it, so multiple clicks in one day overwrite the two rows — never append.
           - After the write we DELETE rows older than 2 years. So the table can hold at most ~1460 rows (2 channels x ~730 days).

         Wrapped in withTransaction (compute-then-upsert-then-prune as one unit) for consistency with the module's other snapshot
         writer. The compute is a read; only the upsert + prune mutate our own snapshot table.

         Requires auth.
=======================================================================================================================================
Request Payload: none (POST)

Success Response:
{
  "return_code": "SUCCESS",
  "today": {
    "shp": { "date": "2026-07-11", "in_stock_selling": 166, "in_stock_no_sale": 22, "oos_sold_recently": 43, "dormant": 34,
             "alive": 231, "total": 265 },
    "amz": { ... same shape ... }
  },
  "pruned": 0   // rows removed for being older than 2 years
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
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { computeStockPosition } = require('../utils/stockPosition');
const logger = require('../utils/logger');

router.use(verifyToken);

// 'YYYY-MM-DD' for today, no timezone drift.
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Add the derived `alive` (= total - dormant) and a date to a raw counts row.
function shape(r, date) {
  const in_stock_selling = Number(r.in_stock_selling) || 0;
  const in_stock_no_sale = Number(r.in_stock_no_sale) || 0;
  const oos_sold_recently = Number(r.oos_sold_recently) || 0;
  const dormant = Number(r.dormant) || 0;
  const total = Number(r.total) || 0;
  return {
    date,
    in_stock_selling,
    in_stock_no_sale,
    oos_sold_recently,
    dormant,
    alive: in_stock_selling + in_stock_no_sale + oos_sold_recently,
    total,
  };
}

router.post('/', async (req, res) => {
  try {
    // 1) Compute the current reading for both channels (read-only; shared util).
    const { shp, amz } = await computeStockPosition();

    // 2) Upsert today's two rows + prune past the 2-year retention, atomically. Latest run of the day wins.
    const pruned = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO stock_position_snapshot
           (snapshot_date, channel, in_stock_selling, in_stock_no_sale, oos_sold_recently, dormant, total, created_at)
         VALUES
           (CURRENT_DATE, 'SHP', $1, $2, $3, $4, $5, now()),
           (CURRENT_DATE, 'AMZ', $6, $7, $8, $9, $10, now())
         ON CONFLICT (snapshot_date, channel)
         DO UPDATE SET in_stock_selling  = EXCLUDED.in_stock_selling,
                       in_stock_no_sale  = EXCLUDED.in_stock_no_sale,
                       oos_sold_recently = EXCLUDED.oos_sold_recently,
                       dormant           = EXCLUDED.dormant,
                       total             = EXCLUDED.total,
                       created_at        = now()`,
        [
          shp.in_stock_selling, shp.in_stock_no_sale, shp.oos_sold_recently, shp.dormant, shp.total,
          amz.in_stock_selling, amz.in_stock_no_sale, amz.oos_sold_recently, amz.dormant, amz.total,
        ]
      );
      const del = await client.query(
        `DELETE FROM stock_position_snapshot WHERE snapshot_date < CURRENT_DATE - INTERVAL '2 years'`
      );
      return del.rowCount || 0;
    });

    const date = todayIso();
    const today = { shp: shape(shp, date), amz: shape(amz, date) };

    return res.json({ return_code: 'SUCCESS', today, pruned });
  } catch (err) {
    logger.error('[analytics-stock-position-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update Stock Position snapshot' });
  }
});

module.exports = router;
