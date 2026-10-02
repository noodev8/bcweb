/*
=======================================================================================================================================
API Route: amz_shipment_scan
=======================================================================================================================================
Method: GET  ?scan=<raw scanner value>
Purpose: AMZ Shipment screen — what is the shoe just scanned into a box? READ ONLY, one round trip per scan.

         The scanner sends whatever is on the shoe box: our code, the EAN barcode, or (once labelled) the Amazon FNSKU. All three are
         matched exactly — code and FNSKU ignoring case, EAN with the trailing 'B' stripped on both sides (CLAUDE.md), the same rule
         goods-in-book uses. A deleted skumap row only wins when there is no live one.

         The FNSKU comes from amzfeed joined on CODE (not amzfeed.sku, which is the Amazon seller-SKU — see order-status-add.js). It is
         returned blank rather than refused: "no FNSKU, can't go in an Amazon box" is the screen's rule to show (owner, 2026-10-02), and
         it still wants the product's name to say WHICH shoe it was.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "code": "1010551-039", "sku": "1010551-039", "fnsku": "X000Q6ARLD", "title": "Arizona Birko-Flor Stone" }
  — fnsku/sku are '' when amzfeed has nothing for the code.
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" · "UNAUTHORIZED" · "SERVER_ERROR"
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
    // EANs are stored with a trailing 'B' on some rows; a scanner never sends it, but strip it if typed so both sides match.
    const ean = /^\d+B$/.test(raw) ? raw.slice(0, -1) : raw;

    // Candidates from all three routes in, best first: a live skumap row before a deleted one. amzfeed is LATERAL ... LIMIT 1 so a
    // code with two feed rows can't return twice.
    const result = await query(
      `WITH hit AS (
         SELECT code FROM skumap WHERE UPPER(code) = $1 OR regexp_replace(COALESCE(ean, ''), 'B$', '') = $2
         UNION
         SELECT code FROM amzfeed WHERE UPPER(fnsku) = $1
       )
       SELECT m.code, COALESCE(af.sku, '') AS sku, COALESCE(af.fnsku, '') AS fnsku, COALESCE(t.shopifytitle, '') AS title
         FROM hit h
         JOIN skumap m ON m.code = h.code
         LEFT JOIN title t ON t.groupid = m.groupid
         LEFT JOIN LATERAL (SELECT a.sku, a.fnsku FROM amzfeed a WHERE a.code = m.code AND COALESCE(a.fnsku, '') <> '' LIMIT 1) af ON true
        ORDER BY COALESCE(m.deleted, 0) ASC
        LIMIT 1`,
      [raw, ean]
    );
    if (result.rows.length === 0) return res.json({ return_code: 'NOT_FOUND', message: `${raw} isn't a product we know` });

    const r = result.rows[0];
    return res.json({ return_code: 'SUCCESS', code: r.code, sku: r.sku, fnsku: r.fnsku, title: r.title });
  } catch (err) {
    logger.error('[amz-shipment-scan] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to look up the scan' });
  }
});

module.exports = router;
