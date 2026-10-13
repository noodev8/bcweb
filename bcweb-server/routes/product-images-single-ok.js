/*
=======================================================================================================================================
API Route: product_images_single_ok
=======================================================================================================================================
Method: POST
Purpose: TEMPORARY (owner, 2026-10-13) — mark / unmark a product as "only one image available", so the Missing Images counter treats it
         as done when no second picture can be found. Sets or clears skusummary.single_image_ok_at; nothing else (no Shopify push — the
         gallery is unchanged). Drop with the column once the re-imaging push is finished (migrations/20261013_single_image_ok.sql).
         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "0051791-ARIZONA",   // string, required
  "ok": true                      // boolean — true marks, false clears
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0051791-ARIZONA",
  "single_ok": true
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.post('/', verifyToken, async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = String(body.groupid || '').trim();
    if (!groupid || typeof body.ok !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and ok (true|false) are required' });
    }
    const r = await query(
      `UPDATE skusummary SET single_image_ok_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE groupid = $1`,
      [groupid, body.ok]
    );
    if (r.rowCount === 0) return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    return res.json({ return_code: 'SUCCESS', groupid, single_ok: body.ok });
  } catch (err) {
    logger.error('[product-images-single-ok] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update' });
  }
});

module.exports = router;
