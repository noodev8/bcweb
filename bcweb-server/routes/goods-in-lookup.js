/*
=======================================================================================================================================
API Route: goods_in_lookup
=======================================================================================================================================
Method: GET
Purpose: Turn one barcode scan into a real SKU. Step 1 of booking a unit in, and READ ONLY — it writes nothing, so a scan that turns
         out to be wrong costs nothing.

WHY IT IS SEPARATE FROM /goods-in-expected. The expected list answers "what is coming"; this answers "what is in my hand", and the two
genuinely differ. A supplier ships something nobody ordered often enough that the legacy screen had a branch for it (of_save: no order
line found -> still goes to a shelf, as free stock). If the screen could only resolve scans against the expected list, that shoe would
read as NOT FOUND — indistinguishable from a damaged label — and the operator would put a real, sellable unit to one side.

THE GUN SENDS EITHER FORM, so both are accepted: the EAN off the box, or the SKU code off a re-print. `skumap.ean` carries a trailing
'B' on many rows (CLAUDE.md) and the scanner does not send it, so the column is stripped before comparison rather than the input being
padded. Matching is exact on both — a substring or fuzzy match on a barcode is how you book in the wrong shoe.

DELETED SKUs (`skumap.deleted = 1`) STILL RESOLVE. They are out of the catalogue, not out of the warehouse: a unit of one can still
physically arrive, and the operator needs it identified so it can be put somewhere. `deleted` comes back on the row so the screen can
say so.
=======================================================================================================================================
Request Query Params:
  scan  (string, required) — the raw barcode or SKU code, any case; a trailing 'B' on a numeric barcode is stripped here too

Success Response:
{
  "return_code": "SUCCESS",
  "sku": { "code": "1005292-ARIZONA-38", "groupid": "1005292-ARIZONA", "title": "Arizona Stone Coin", "size": "38",
           "barcode": "4051619305203", "supplier": "Birkenstock", "deleted": false }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"        -- nothing in skumap matches; the screen stops the line
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
    const raw = (req.query.scan || '').trim();
    if (!raw) return res.json({ return_code: 'MISSING_FIELDS', message: 'scan is required' });

    // The trailing 'B' is stripped HERE as well as in the client (src/lib/goodsInWrite.ts -> normaliseScan). Belt and braces on
    // purpose: the web screen normalises before sending, but a route whose correctness depends on every future caller remembering to
    // do that is one mobile client away from silently reporting NOT_FOUND for a shoe that is sitting in the catalogue.
    const scan = /^\d+B$/i.test(raw) ? raw.slice(0, -1) : raw;

    // Both comparisons are exact and parameterised. UPPER on each side because codes are stored upper-case but a re-printed label can
    // be scanned in either case; barcodes are digits, so the fold costs nothing there.
    const result = await query(`
      SELECT sm.code, sm.groupid, t.shopifytitle AS title,
             RIGHT(sm.code, 2) AS size,
             regexp_replace(COALESCE(sm.ean, ''), 'B$', '') AS barcode,
             sm.supplier,
             COALESCE(sm.deleted, 0) AS deleted
      FROM skumap sm
      LEFT JOIN title t ON t.groupid = sm.groupid
      WHERE UPPER(sm.code) = UPPER($1)
         OR regexp_replace(COALESCE(sm.ean, ''), 'B$', '') = $1
      ORDER BY COALESCE(sm.deleted, 0) ASC
      LIMIT 1
    `, [scan]);

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No SKU matches that scan' });
    }

    const r = result.rows[0];
    return res.json({
      return_code: 'SUCCESS',
      sku: {
        code: r.code,
        groupid: r.groupid || null,
        title: r.title || null,
        size: r.size,
        barcode: r.barcode || '',
        supplier: r.supplier || null,
        deleted: Number(r.deleted) === 1,
      },
    });
  } catch (err) {
    logger.error('[goods-in-lookup] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to look that scan up' });
  }
});

module.exports = router;
