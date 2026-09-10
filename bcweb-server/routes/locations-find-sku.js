/*
=======================================================================================================================================
API Route: locations_find_sku
=======================================================================================================================================
Method: POST
Purpose: Turn what the gun just fired — or what someone typed — into the ONE size code the stock write needs. READ ONLY.

WHY IT EXISTS. The Locations screen's add box says "scan a shoe", and a scanned shoe is a BARCODE, while inv-adjust (the write behind
the +/-) takes a `code`. Without a resolver between them the box is a lie: it would accept a scan, hand the barcode straight to the
write as if it were a SKU, and get back a shrug. So the screen resolves first and adds second, and the operator finds out the scan was
unreadable BEFORE anything is written rather than after.

THE MATCHING RULE IS THE ONE GOODS IN ALREADY USES, deliberately identical so the same shoe scans the same way on both screens: code
exactly (case-insensitively), or `skumap.ean` with the trailing 'B' stripped (CLAUDE.md). Live rows are preferred over soft-deleted
ones, which is what the ORDER BY on `deleted` is for — a retired variant should never win a scan from a current one.

IT RESOLVES, IT DOES NOT JUDGE. Whether the code can go on that rack, and what happens if it is already there, is the write's business
(inv-adjust) and the screen's. This route answers one question — "what am I holding?" — and the title comes back with it so the screen
can show the operator the name of the shoe before they commit to putting it somewhere.
=======================================================================================================================================
Request Payload:
{
  "scan": "5059069037681"          // required — a barcode as scanned, or a size code typed by hand
}

Success Response:
{
  "return_code": "SUCCESS",
  "code": "0051191-ARIZONA-38",
  "groupid": "0051191-ARIZONA",
  "title": "Birkenstock Arizona Two-Strap Birko-Flor Sandals Black Regular Fit",
  "size": "38"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    -- nothing was sent to look up
"NOT_FOUND"         -- no SKU matches that scan
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
    // Upper-cased and trimmed for the same reason Goods In normalises a scan: a gun's output and a typed SKU should not be two
    // different things. The trailing-'B' strip lives in the SQL, against the column that carries it.
    const scan = typeof req.body?.scan === 'string' ? req.body.scan.trim().toUpperCase() : '';
    if (!scan) return res.json({ return_code: 'MISSING_FIELDS', message: 'scan is required' });

    const result = await query(`
      SELECT m.code, m.groupid, RIGHT(m.code, 2) AS size, t.shopifytitle AS title
      FROM skumap m
      LEFT JOIN title t ON t.groupid = m.groupid
      WHERE UPPER(m.code) = $1
         OR regexp_replace(COALESCE(m.ean, ''), 'B$', '') = $1
      ORDER BY COALESCE(m.deleted, 0) ASC
      LIMIT 1
    `, [scan]);

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `Nothing matches ${scan}` });
    }
    const r = result.rows[0];
    return res.json({
      return_code: 'SUCCESS',
      code: r.code,
      groupid: r.groupid || null,
      title: r.title || null,
      size: r.size || '',
    });
  } catch (err) {
    logger.error('[locations-find-sku] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to look that up' });
  }
});

module.exports = router;
