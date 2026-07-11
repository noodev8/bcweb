/*
=======================================================================================================================================
API Route: birk_tracker_update
=======================================================================================================================================
Method: POST
Purpose: Analytics module — Birk Tracker "Update" button. Recomputes the current Birkenstock core-size availability snapshot
         (utils/birkStock.js) and UPSERTs it into birk_stock_snapshot as TODAY's row (latest run of the day wins), then prunes any
         rows older than 2 years. Manual-trigger only (no cron) — the owner clicks Update when they want a fresh reading.

         Growth safeguard (why this is bounded):
           - snapshot_date is the PK and we UPSERT it, so multiple clicks in one day overwrite the single row — never append.
           - After the write we DELETE rows older than 2 years. So the table can hold at most ~730 rows, ever.

         Wrapped in withTransaction (compute-then-upsert-then-prune as one unit) for consistency with the other writes, even though a
         single style row isn't at stake here. The compute is a read; only the upsert + prune mutate our own snapshot table.

         Requires auth.
=======================================================================================================================================
Request Payload: none (POST)

Success Response:
{
  "return_code": "SUCCESS",
  "latest": { "date": "2026-07-11", "full": 39, "styles": 149, "full_pct": 26 },
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
const { computeBirkSnapshot } = require('../utils/birkStock');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    // 1) Compute the current reading (read-only; heavy lifting lives in the shared util so the GET could reuse it if ever needed).
    const { full, styles, totalFree, coreFree } = await computeBirkSnapshot();

    // 2) Upsert today's row + prune anything past the 2-year retention, atomically.
    const pruned = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO birk_stock_snapshot (snapshot_date, full_count, styles_count, total_free_units, core_free_units, created_at)
              VALUES (CURRENT_DATE, $1, $2, $3, $4, now())
         ON CONFLICT (snapshot_date)
         DO UPDATE SET full_count = EXCLUDED.full_count,
                       styles_count = EXCLUDED.styles_count,
                       total_free_units = EXCLUDED.total_free_units,
                       core_free_units = EXCLUDED.core_free_units,
                       created_at = now()`,
        [full, styles, totalFree, coreFree]
      );

      const del = await client.query(
        `DELETE FROM birk_stock_snapshot WHERE snapshot_date < CURRENT_DATE - INTERVAL '2 years'`
      );
      return del.rowCount || 0;
    });

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const full_pct = styles ? Math.round((full / styles) * 100) : 0;

    return res.json({
      return_code: 'SUCCESS',
      latest: { date, full, styles, full_pct, total_free: totalFree, core_free: coreFree },
      pruned,
    });
  } catch (err) {
    logger.error('[birk-tracker-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update Birk Tracker snapshot' });
  }
});

module.exports = router;
