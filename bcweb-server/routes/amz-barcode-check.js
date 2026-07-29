/*
=======================================================================================================================================
API Route: amz_barcode_check
=======================================================================================================================================
Method: GET
Purpose: Update Amazon module — the FNSKU list that the barcode panel diffs against the operator's barcode folder.

         Every FNSKU Amazon has given us needs a printable barcode image (<FNSKU>.bmp) sitting in a Google Drive folder on the
         operator's machine, because that folder is what the label printing feeds off. New FNSKUs arrive with new Amazon products, so
         after an import there may be barcodes that don't exist yet.

         THIS ROUTE DOES NOT KNOW WHAT IS IN THE FOLDER, and cannot: the API runs on a VPS and the folder is a synced directory on a
         PC. It returns what SHOULD be there and the browser does the diff (File System Access API) and the generating. So this stays
         a plain read — no filesystem, no images, nothing to go wrong.

         The legacy PowerBuilder equivalent (of_checkbarcodesdb) additionally skipped SKUs whose skumap.status was '0', to avoid
         cluttering the folder with barcodes for dead products. Dropped on the owner's instruction 2026-07-29 — folder size is not a
         problem and a missing barcode is, so every live FNSKU gets one. That also removes the skumap join entirely.

         The guard against a literal 'FNSKU' value is inherited from the legacy loop: an Amazon report header row that got imported as
         data would otherwise ask for a barcode called "FNSKU.bmp". Currently matches nothing, kept because it costs nothing.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "fnskus": [ { "fnsku": "X000Q6ARLD", "code": "1010551039", "sku": "1010551-039", "title": "Arizona Birko-Flor Stone" } ],
  "total": 522
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    // title is joined on groupid (amzfeed carries it directly) purely so the operator can see WHAT a missing barcode is for —
    // skusummary.colour is an overloaded segmentation tag and no use as a human name. LEFT JOIN so a style with no title row still
    // gets its barcode; the panel just shows the code instead.
    const result = await query(
      `SELECT a.fnsku, a.code, a.sku, COALESCE(t.shopifytitle, '') AS title
         FROM amzfeed a
         LEFT JOIN title t ON t.groupid = a.groupid
        WHERE COALESCE(a.fnsku, '') <> ''
          AND UPPER(a.fnsku) <> 'FNSKU'
        ORDER BY a.fnsku`
    );

    return res.json({
      return_code: 'SUCCESS',
      fnskus: result.rows.map((r) => ({
        fnsku: r.fnsku,
        code: r.code || '',
        sku: r.sku || '',
        title: r.title || '',
      })),
      total: result.rows.length,
    });
  } catch (err) {
    logger.error('[amz-barcode-check] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the FNSKU list' });
  }
});

module.exports = router;
