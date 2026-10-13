/*
=======================================================================================================================================
API Route: order_status_customer_scan
=======================================================================================================================================
Method: GET  ?scan=<raw scanner value>
Purpose: Customer Orders scan-to-label — which product is the shoe just scanned? READ ONLY. Resolves the scanner value to our code;
         the screen then finds the oldest open order needing it and ticks it off (CustomerOrderList.tsx onScan).

         The box carries our code or the EAN. Same match rule as amz-shipment-scan.js: code ignoring case, EAN with the trailing 'B'
         stripped (CLAUDE.md). A deleted skumap row only wins when there is no live one. A value skumap doesn't know is NOT refused —
         it comes back as-is, because an order line can carry a code skumap has lost, and the screen's "no customer order waiting for
         this shoe" is the right message either way.

WHY SCANS AREN'T STORED (owner, 2026-10-13: no new table). Scan progress lives on the screen while the order is being boxed; the
codes go to /order-status-customer-label with the print request, and that route checks them against the order before it buys postage.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "code": "1010551-039", "known": true }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    const raw = String(req.query.scan || '').trim().toUpperCase();
    if (!raw) return res.json({ return_code: 'MISSING_FIELDS', message: 'scan is required' });
    const ean = /^\d+B$/.test(raw) ? raw.slice(0, -1) : raw;

    const result = await query(
      `SELECT code FROM skumap
        WHERE UPPER(code) = $1 OR regexp_replace(COALESCE(ean, ''), 'B$', '') = $2
        ORDER BY COALESCE(deleted, 0) ASC
        LIMIT 1`,
      [raw, ean]
    );
    if (result.rows.length === 0) return res.json({ return_code: 'SUCCESS', code: raw, known: false });
    return res.json({ return_code: 'SUCCESS', code: result.rows[0].code, known: true });
  } catch (err) {
    logger.error('[order-status-customer-scan] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to look up the scan' });
  }
});

module.exports = router;
